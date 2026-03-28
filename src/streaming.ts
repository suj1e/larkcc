/**
 * 流式卡片模块（Update 模式）
 *
 * 使用飞书消息 message.patch API 模拟流式输出。
 * CardKit 模式已迁移至 cardkit.ts，采用单卡片架构。
 *
 * - update: message.patch 模拟流式（无需额外权限）
 * - none: 禁用流式
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { optimizeForCard } from "./format/card-optimize.js";
import { parseThinking, stripThinking } from "./format/thinking.js";
import type { StreamingConfig } from "./config.js";
import type { ReplyContext } from "./feishu.js";
import { replyFinalCard, buildMarkdownCard } from "./feishu.js";
import type { CardBuildOptions } from "./feishu.js";

// ── FlushController：互斥守卫 + 自适应节流 + 长间隔批处理 ───────────

const LONG_GAP_MS = 2000;   // 2 秒无新内容，强制刷新
const GAP_CHECK_INTERVAL = 500; // 每 500ms 检查一次长间隔
const HEARTBEAT_MS = 15000;  // 15 秒无 flush，发送心跳防止 CardKit 流式超时
const TRUNCATE_LIMIT = 4000;

export interface FlushControllerOptions {
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
export class FlushController {
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

  /** 强制刷新（即使 buffer 为空，用于工具状态变更等场景） */
  async flush(): Promise<void> {
    await this.doFlush(true);
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
      void this.doFlush(false);
    }, delay);
  }

  private async doFlush(force: boolean): Promise<void> {
    if (this.flushing || this.stopped) return;
    if (!force && this.buffer.length <= this.sentLength) return;

    this.flushing = true;
    try {
      await this.onFlush(this.buffer);
      if (!force) this.sentLength = this.buffer.length;
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
    const now = Date.now();
    // 15s 心跳：即使 buffer 无变化也 flush 一次，防止 CardKit 流式超时
    if (now - this.lastFlushTime > HEARTBEAT_MS) {
      void this.doFlush(true);
      return;
    }
    // 2s 长间隔：有未发送内容时强制刷新
    if (now - this.lastAppendTime > LONG_GAP_MS) {
      if (this.buffer.length > this.sentLength) {
        void this.doFlush(false);
      }
    }
  }
}

// ── 流式卡片接口 ──────────────────────────────────────────────

export interface CompleteOptions {
  /** 底部元数据（耗时、token 等） */
  metadata?: string;
  /** 思考内容，显示在可折叠区域 */
  thinking?: string;
  /** 思考耗时（毫秒） */
  reasoningElapsedMs?: number;
  /** 卡片标题 */
  cardTitle?: string;
}

export interface IStreamingCard {
  append(text: string): Promise<void>;
  complete(finalContent: string, options?: CompleteOptions): Promise<void>;
  abort(options?: { content?: string; thinking?: string; reasoningElapsedMs?: number }): Promise<void>;
  isDisabled(): boolean;
}

// ── Update 模式（message.patch） ───────────────────────────────────

class UpdateStreamingCard implements IStreamingCard {
  private client: lark.Client;
  private rootMsgId: string;
  private fallbackOnError: boolean;
  private thinkingEnabled: boolean;
  private context: ReplyContext;
  private cardTitle: string;

  private msgId: string | null = null;
  private _disabled = false;
  private _started = false;
  private flushCtrl: FlushController;

  constructor(
    client: lark.Client,
    rootMsgId: string,
    intervalMs: number,
    fallbackOnError: boolean,
    thinkingEnabled: boolean,
    context: ReplyContext,
    cardTitle: string,
  ) {
    this.client = client;
    this.rootMsgId = rootMsgId;
    this.fallbackOnError = fallbackOnError;
    this.thinkingEnabled = thinkingEnabled;
    this.context = context;
    this.cardTitle = cardTitle;

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

  private async ensureStarted(): Promise<void> {
    if (this._disabled) return;
    if (this._started) return;

    try {
      const card: any = {
        schema: "2.0",
        config: { wide_screen_mode: true },
        body: { elements: [{ tag: "markdown", content: "⏳ 思考中..." }] },
      };
      if (this.cardTitle) {
        card.header = {
          title: { tag: "plain_text", content: this.cardTitle },
          template: "blue",
        };
      }
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
        this._started = true;
      } else {
        console.error("[STREAM] Failed to get message_id from initial card");
        this._disabled = true;
      }
    } catch (error) {
      console.error("[STREAM] Failed to start streaming card:", error);
      this._disabled = true;
    }
  }

  async append(text: string): Promise<void> {
    await this.ensureStarted();
    if (this._disabled) return;
    this.flushCtrl.append(text);
  }

  private async performFlush(content: string): Promise<void> {
    if (this._disabled || !this.msgId) return;

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
    const truncated = optimized.length > TRUNCATE_LIMIT ? optimized.slice(0, TRUNCATE_LIMIT) + "\n\n..." : optimized;

    const card = buildMarkdownCard(truncated, [], { ...cardOptions, cardTitle: this.cardTitle });
    await this.client.im.message.patch({
      path: { message_id: this.msgId },
      data: { content: JSON.stringify(card) },
    });
  }

  async complete(finalContent: string, options?: CompleteOptions): Promise<void> {
    this.flushCtrl.stop();

    if (this._disabled || !this.msgId) {
      await replyFinalCard(
        this.client, this.context.chatId, this.rootMsgId,
        finalContent, this.context, options,
      );
      return;
    }

    let content = finalContent;
    if (options?.metadata) {
      content += `\n\n---\n${options.metadata}`;
    }

    const optimized = optimizeForCard(content);
    const cardOptions: CardBuildOptions | undefined = {
      thinking: options?.thinking,
      cardTitle: this.cardTitle,
    };

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

  async abort(options?: { content?: string; thinking?: string; reasoningElapsedMs?: number }): Promise<void> {
    this.flushCtrl.stop();
    if (this._disabled || !this.msgId) return;

    const text = options?.content || "⏹ 任务已中断";
    const optimized = optimizeForCard(text);
    try {
      const card = buildMarkdownCard(optimized, [], {
        cardTitle: this.cardTitle,
        thinking: options?.thinking,
        reasoningElapsedMs: options?.reasoningElapsedMs,
      });
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

// ── 工厂函数 ─────────────────────────────────────────────────────

/**
 * 创建 Update 模式流式卡片
 * CardKit 模式请使用 cardkit.ts 中的 CardKitController
 */
export function createStreamingCard(
  config: StreamingConfig | undefined,
  client: lark.Client,
  rootMsgId: string,
  context: ReplyContext,
  cardTitle?: string,
): IStreamingCard | null {
  if (!config?.enabled || config.mode === "none" || config.mode === "cardkit") {
    return null;
  }

  const intervalMs = config.flush_interval_ms || 300;
  const fallbackOnError = config.fallback_on_error !== false;
  const thinkingEnabled = config.thinking_enabled === true;

  return new UpdateStreamingCard(
    client, rootMsgId, intervalMs, fallbackOnError, thinkingEnabled, context, cardTitle ?? "",
  );
}
