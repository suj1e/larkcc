/**
 * 流式卡片模块
 *
 * 支持两种流式模式：
 * - update: 使用飞书消息 message.patch API 模拟流式（无需额外权限）
 * - cardkit: 使用飞书 CardKit API 实现真正的打字机效果（需要 CardKit 权限）
 * - none: 禁用流式
 *
 * CardKit 失败时自动降级为 update 模式，update 失败时降级为一次性发送。
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { optimizeForCard } from "./format/card-optimize.js";
import { parseThinking, stripThinking } from "./format/thinking.js";
import type { StreamingConfig } from "./config.js";
import type { ReplyContext } from "./feishu.js";
import { replyFinalCard, buildMarkdownCard, getTenantAccessToken } from "./feishu.js";
import type { CardBuildOptions } from "./feishu.js";

// ── CardKit API 常量 ──────────────────────────────────────────────

const CARDKIT_BASE = "https://open.feishu.cn/open-apis/cardkit/v1";

// ── FlushController：互斥守卫 + 自适应节流 + 长间隔批处理 ───────────

const LONG_GAP_MS = 2000;   // 2 秒无新内容，强制刷新
const GAP_CHECK_INTERVAL = 500; // 每 500ms 检查一次长间隔

interface FlushControllerOptions {
  /** 最小刷新间隔（毫秒） */
  minIntervalMs: number;
  /** 刷新回调，接收完整 buffer 内容 */
  onFlush: (content: string) => Promise<void>;
  /** 刷新失败回调 */
  onError?: (error: unknown) => void;
}

/**
 * 刷新控制器
 *
 * 核心机制：
 * - 互斥锁防止并发刷新
 * - setTimeout 替代 setInterval（上次完成后才调度下次）
 * - 自适应延迟：delay = max(0, minInterval - elapsed)
 * - 长间隔检测：2s 无新内容 → 强制刷新剩余
 *
 * 生命周期：start() → [append() → doFlush()]* → stop()
 */
class FlushController {
  private minIntervalMs: number;
  private onFlush: (content: string) => Promise<void>;
  private onError?: (error: unknown) => void;

  private buffer = "";
  private sentLength = 0;
  private flushing = false;        // 互斥锁
  private stopped = false;
  private lastFlushTime = 0;
  private lastAppendTime = 0;

  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private gapCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: FlushControllerOptions) {
    this.minIntervalMs = options.minIntervalMs;
    this.onFlush = options.onFlush;
    this.onError = options.onError;
  }

  /** 追加内容到 buffer */
  append(text: string): void {
    if (this.stopped) return;
    this.buffer += text;
    this.lastAppendTime = Date.now();
    this.scheduleFlush();
  }

  /** 启动长间隔检测 */
  start(): void {
    this.lastAppendTime = Date.now();
    this.lastFlushTime = Date.now();
    this.gapCheckTimer = setInterval(() => this.checkLongGap(), GAP_CHECK_INTERVAL);
  }

  /** 停止所有定时器。调用后 append() 不再生效，调用方负责刷新剩余 buffer 内容 */
  stop(): void {
    this.stopped = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.gapCheckTimer) {
      clearInterval(this.gapCheckTimer);
      this.gapCheckTimer = null;
    }
  }

  /** 强制刷新（供外部调用） */
  async flush(): Promise<void> {
    await this.doFlush();
  }

  /** 获取当前 buffer 内容 */
  getBuffer(): string {
    return this.buffer;
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.stopped) return;

    const elapsed = Date.now() - this.lastFlushTime;
    const delay = Math.max(0, this.minIntervalMs - elapsed);

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.doFlush();
    }, delay);
  }

  private async doFlush(): Promise<void> {
    if (this.flushing || this.stopped) return;
    if (this.buffer.length <= this.sentLength) return;

    this.flushing = true;
    try {
      await this.onFlush(this.buffer);
      this.sentLength = this.buffer.length;
      this.lastFlushTime = Date.now();
    } catch (error) {
      if (this.onError) {
        this.onError(error);
      }
      this.stop();
      return;
    } finally {
      this.flushing = false;
    }

    // 刷新期间可能有新内容到达，继续调度
    if (!this.stopped && this.buffer.length > this.sentLength) {
      this.scheduleFlush();
    }
  }

  private checkLongGap(): void {
    if (this.stopped || this.flushing) return;
    if (Date.now() - this.lastAppendTime > LONG_GAP_MS) {
      if (this.buffer.length > this.sentLength) {
        void this.doFlush();
      }
    }
  }
}

// ── 流式卡片抽象接口 ──────────────────────────────────────────────

export interface CompleteOptions {
  /** 底部元数据（耗时、token 等） */
  metadata?: string;
  /** 思考内容，显示在可折叠区域 */
  thinking?: string;
}

/**
 * 流式卡片控制器
 *
 * 生命周期：
 * start() → [append() → flush()]* → complete() / abort()
 */
export interface IStreamingCard {
  start(): Promise<void>;
  append(text: string): void;
  complete(finalContent: string, options?: CompleteOptions): Promise<void>;
  abort(message: string): Promise<void>;
  isDisabled(): boolean;
}

// ── Update 模式（message.patch） ───────────────────────────────────

class UpdateStreamingCard implements IStreamingCard {
  private client: lark.Client;
  private rootMsgId: string;
  private fallbackOnError: boolean;
  private thinkingEnabled: boolean;
  private context: ReplyContext;

  private msgId: string | null = null;
  private _disabled = false;
  private flushCtrl: FlushController;

  constructor(
    client: lark.Client,
    rootMsgId: string,
    intervalMs: number,
    fallbackOnError: boolean,
    thinkingEnabled: boolean,
    context: ReplyContext,
  ) {
    this.client = client;
    this.rootMsgId = rootMsgId;
    this.fallbackOnError = fallbackOnError;
    this.thinkingEnabled = thinkingEnabled;
    this.context = context;

    this.flushCtrl = new FlushController({
      minIntervalMs: intervalMs,
      onFlush: (content) => this.performFlush(content),
      onError: (error) => {
        console.error("[STREAM] Flush failed:", error);
        if (this.fallbackOnError) {
          console.error("[STREAM] Disabling streaming, will fallback to final send");
          this._disabled = true;
        }
      },
    });
  }

  async start(): Promise<void> {
    try {
      const card = {
        schema: "2.0",
        body: { elements: [{ tag: "markdown", content: "⏳ 思考中..." }] },
      };
      const res = await (this.client.im.message as any).reply({
        path: { message_id: this.rootMsgId },
        data: {
          content: JSON.stringify(card),
          msg_type: "interactive",
          reply_in_thread: false,
        },
      });
      this.msgId = res.data?.message_id ?? null;

      if (this.msgId) {
        this.flushCtrl.start();
      } else {
        console.error("[STREAM] Failed to get message_id from initial card");
        this._disabled = true;
      }
    } catch (error) {
      console.error("[STREAM] Failed to start streaming card:", error);
      this._disabled = true;
    }
  }

  append(text: string): void {
    if (this._disabled) return;
    this.flushCtrl.append(text);
  }

  private async performFlush(content: string): Promise<void> {
    if (this._disabled || !this.msgId) return;

    // 解析 thinking
    let displayContent = content;
    let cardOptions: CardBuildOptions | undefined;

    if (this.thinkingEnabled) {
      const parsed = parseThinking(content);
      displayContent = parsed.content;
      if (parsed.isThinking && !parsed.content) {
        cardOptions = { thinkingInProgress: true };
        displayContent = "💭 思考中...";
      } else if (parsed.isThinking) {
        cardOptions = { thinkingInProgress: true };
      } else if (parsed.thinking) {
        cardOptions = { thinking: parsed.thinking };
      }
    } else {
      displayContent = stripThinking(content);
    }

    if (!displayContent.trim()) return;

    const optimized = optimizeForCard(displayContent);
    const truncated = optimized.length > 4000 ? optimized.slice(0, 4000) + "\n\n..." : optimized;

    const card = buildMarkdownCard(truncated, [], cardOptions);
    await this.client.im.message.patch({
      path: { message_id: this.msgId },
      data: { content: JSON.stringify(card) },
    });
  }

  async complete(finalContent: string, options?: CompleteOptions): Promise<void> {
    this.flushCtrl.stop();

    if (this._disabled || !this.msgId) {
      if (this.msgId) {
        try {
          const card = {
            schema: "2.0",
            body: { elements: [{ tag: "markdown", content: "📝 处理中..." }] },
          };
          await this.client.im.message.patch({
            path: { message_id: this.msgId },
            data: { content: JSON.stringify(card) },
          });
        } catch (error) {
          console.error("[STREAM] Fallback patch failed:", error);
        }
      }
      await replyFinalCard(
        this.client, this.context.chatId, this.rootMsgId,
        finalContent, this.context, options,
      );
      return;
    }

    // 追加 metadata
    let content = finalContent;
    if (options?.metadata) {
      content += `\n\n---\n${options.metadata}`;
    }

    const optimized = optimizeForCard(content);
    const cardOptions: CardBuildOptions | undefined = options?.thinking
      ? { thinking: options.thinking }
      : undefined;

    try {
      const card = buildMarkdownCard(optimized, [], cardOptions);
      await this.client.im.message.patch({
        path: { message_id: this.msgId },
        data: { content: JSON.stringify(card) },
      });
    } catch (error) {
      console.error("[STREAM] Final patch failed, sending as new message:", error);
      await replyFinalCard(
        this.client, this.context.chatId, this.rootMsgId,
        finalContent, this.context, options,
      );
    }
  }

  async abort(message: string): Promise<void> {
    this.flushCtrl.stop();
    if (this._disabled || !this.msgId) return;

    const optimized = optimizeForCard(message);
    try {
      const card = {
        schema: "2.0",
        body: { elements: [{ tag: "markdown", content: optimized }] },
      };
      await this.client.im.message.patch({
        path: { message_id: this.msgId },
        data: { content: JSON.stringify(card) },
      });
    } catch (error) {
      console.error("[STREAM] Abort patch failed:", error);
    }
  }

  isDisabled(): boolean {
    return this._disabled;
  }
}

// ── CardKit 模式 ─────────────────────────────────────────────────

class CardKitStreamingCard implements IStreamingCard {
  private client: lark.Client;
  private appId: string;
  private appSecret: string;
  private token: string = "";
  private rootMsgId: string;
  private fallbackOnError: boolean;
  private thinkingEnabled: boolean;
  private context: ReplyContext;

  private cardId: string | null = null;
  private elementId: string | null = null;
  private _disabled = false;
  private flushCtrl: FlushController;

  constructor(
    client: lark.Client,
    appId: string,
    appSecret: string,
    rootMsgId: string,
    intervalMs: number,
    fallbackOnError: boolean,
    thinkingEnabled: boolean,
    context: ReplyContext,
  ) {
    this.client = client;
    this.appId = appId;
    this.appSecret = appSecret;
    this.rootMsgId = rootMsgId;
    this.fallbackOnError = fallbackOnError;
    this.thinkingEnabled = thinkingEnabled;
    this.context = context;

    this.flushCtrl = new FlushController({
      minIntervalMs: intervalMs,
      onFlush: (content) => this.performFlush(content),
      onError: (error) => {
        console.error("[CARDKIT] Flush failed:", error);
        if (this.fallbackOnError) {
          console.error("[CARDKIT] Disabling streaming, will fallback to final send");
          this._disabled = true;
        }
      },
    });
  }

  async start(): Promise<void> {
    try {
      // 0. Lazy 获取 tenant_access_token
      this.token = await getTenantAccessToken(this.appId, this.appSecret);

      // 1. 创建 CardKit 卡片实体
      const cardConfig = {
        card_link: {
          pc_url: "",
          android_url: "",
          ios_url: "",
        },
        header: {
          title: { tag: "plain_text", content: "Claude" },
          template: "blue",
        },
        elements: [
          {
            tag: "markdown",
            content: "⏳ 思考中...",
          },
        ],
      };

      const createRes = await fetch(`${CARDKIT_BASE}/cards`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cardConfig),
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        console.error(`[CARDKIT] Failed to create card entity: ${createRes.status} ${errText.slice(0, 200)}`);
        throw new Error(`CardKit create failed: ${createRes.status}`);
      }

      const createData = await createRes.json() as any;
      this.cardId = createData.data?.card?.card_id;
      this.elementId = createData.data?.card?.elements?.[0]?.element_id;

      if (!this.cardId) {
        throw new Error("CardKit: no card_id in response");
      }

      console.error(`[CARDKIT] Card created: ${this.cardId}, element: ${this.elementId}`);

      // 2. 发送消息引用该卡片
      const msgRes = await fetch(`${CARDKIT_BASE}/cards/${this.cardId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          msg_type: "interactive",
          receive_id_type: "chat_id",
          receive_id: this.context.chatId,
        }),
      });

      if (!msgRes.ok) {
        console.error(`[CARDKIT] Failed to send card message: ${msgRes.status}`);
        throw new Error(`CardKit send message failed: ${msgRes.status}`);
      }

      // 3. 启动刷新控制器
      if (this.elementId) {
        this.flushCtrl.start();
      } else {
        console.error("[CARDKIT] No element_id, streaming disabled");
        this._disabled = true;
      }
    } catch (error) {
      console.error("[CARDKIT] Start failed, falling back to update mode:", error);
      if (this.fallbackOnError) {
        this._disabled = true;
      }
    }
  }

  append(text: string): void {
    if (this._disabled) return;
    this.flushCtrl.append(text);
  }

  private async performFlush(content: string): Promise<void> {
    if (this._disabled || !this.cardId || !this.elementId) return;

    // 解析 thinking
    let displayContent = content;
    if (this.thinkingEnabled) {
      const parsed = parseThinking(content);
      displayContent = parsed.isThinking && !parsed.content
        ? "💭 思考中..."
        : parsed.content || "💭 思考中...";
    } else {
      displayContent = stripThinking(content);
    }

    if (!displayContent.trim()) return;

    const optimized = optimizeForCard(displayContent);
    const truncated = optimized.length > 4000 ? optimized.slice(0, 4000) + "\n\n..." : optimized;

    await fetch(`${CARDKIT_BASE}/cards/${this.cardId}/elements/${this.elementId}/stream`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        stream_content: truncated,
      }),
    });
  }

  async complete(finalContent: string, options?: CompleteOptions): Promise<void> {
    this.flushCtrl.stop();

    if (this._disabled || !this.cardId) {
      await replyFinalCard(
        this.client, this.context.chatId, this.rootMsgId,
        finalContent, this.context, options,
      );
      return;
    }

    // 追加 metadata
    let content = finalContent;
    if (options?.metadata) {
      content += `\n\n---\n${options.metadata}`;
    }

    // 最终更新卡片内容
    const optimized = optimizeForCard(content);

    try {
      await fetch(`${CARDKIT_BASE}/cards/${this.cardId}`, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          elements: [
            {
              tag: "markdown",
              content: optimized,
            },
          ],
        }),
      });
    } catch (error) {
      console.error("[CARDKIT] Final update failed, sending as new message:", error);
      await replyFinalCard(
        this.client, this.context.chatId, this.rootMsgId,
        finalContent, this.context, options,
      );
    }
  }

  async abort(message: string): Promise<void> {
    this.flushCtrl.stop();
    if (this._disabled || !this.cardId) return;

    const optimized = optimizeForCard(message);
    try {
      await fetch(`${CARDKIT_BASE}/cards/${this.cardId}`, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          elements: [
            {
              tag: "markdown",
              content: optimized,
            },
          ],
        }),
      });
    } catch (error) {
      console.error("[CARDKIT] Abort update failed:", error);
    }
  }

  isDisabled(): boolean {
    return this._disabled;
  }
}

// ── 降级包装器 ──────────────────────────────────────────────────

/**
 * FallbackStreamingCard：自动降级包装器
 *
 * 启动时先尝试 primary（CardKit），失败后自动切换到 fallback（Update）。
 * 降级后所有操作透明委托给 fallback，调用方无需感知。
 */
class FallbackStreamingCard implements IStreamingCard {
  private primary: IStreamingCard;
  private fallback: IStreamingCard | null = null;

  constructor(
    primary: IStreamingCard,
    private fallbackFactory: () => IStreamingCard,
  ) {
    this.primary = primary;
  }

  private get active(): IStreamingCard {
    return this.fallback ?? this.primary;
  }

  async start(): Promise<void> {
    await this.primary.start();
    if (this.primary.isDisabled()) {
      console.error("[STREAM] Primary streaming failed, activating fallback (update mode)");
      this.fallback = this.fallbackFactory();
      await this.fallback.start();
    }
  }

  append(text: string): void {
    this.active.append(text);
  }

  async complete(finalContent: string, options?: CompleteOptions): Promise<void> {
    await this.active.complete(finalContent, options);
  }

  async abort(message: string): Promise<void> {
    await this.active.abort(message);
  }

  isDisabled(): boolean {
    return this.active.isDisabled();
  }
}

// ── 工厂函数 ─────────────────────────────────────────────────────

/**
 * 根据配置创建流式卡片实例
 * 返回 null 表示不启用流式
 *
 * 降级链：cardkit → update → 一次性发送
 */
export function createStreamingCard(
  config: StreamingConfig | undefined,
  client: lark.Client,
  rootMsgId: string,
  context: ReplyContext,
): IStreamingCard | null {
  if (!config?.enabled || config.mode === "none") {
    return null;
  }

  const intervalMs = config.flush_interval_ms || 300;
  const fallbackOnError = config.fallback_on_error !== false;
  const thinkingEnabled = config.thinking_enabled === true;

  if (config.mode === "cardkit") {
    const primary = new CardKitStreamingCard(
      client, context.appId, context.appSecret,
      rootMsgId, intervalMs, fallbackOnError, thinkingEnabled, context,
    );
    if (fallbackOnError) {
      const fallbackFactory = () => new UpdateStreamingCard(
        client, rootMsgId, intervalMs, fallbackOnError, thinkingEnabled, context,
      );
      return new FallbackStreamingCard(primary, fallbackFactory);
    }
    return primary;
  }

  // update 模式
  return new UpdateStreamingCard(client, rootMsgId, intervalMs, fallbackOnError, thinkingEnabled, context);
}

// 为了向后兼容，保留 StreamingCard 作为导出别名
export type StreamingCard = IStreamingCard;
