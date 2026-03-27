/**
 * CardKit 流式卡片控制器
 *
 * 单卡片架构，对齐飞书官方 OpenClaw 方案。
 * 全程只有一个卡片消息，通过 CardKit API 实现打字机效果。
 * 工具调用不可见，thinking 和最终回答在同一卡片内展示。
 *
 * API 调用链参考飞书官方 openclaw-lark 项目：
 * https://github.com/larksuite/openclaw-lark
 *
 * 状态机：idle → creating → streaming → completed / aborted
 *
 * API 调用链（对齐官方 SDK）：
 * 1. POST /cardkit/v1/cards              → 创建卡片实体
 * 2. im.message.reply({ card_id })       → 发送消息引用卡片
 * 3. PUT  /cardkit/v1/cards/{id}/elements/{eid}/content  → 流式打字机
 * 4. PUT  /cardkit/v1/cards/{id}         → 最终更新（关闭 streaming_mode）
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { optimizeForCard } from "./format/card-optimize.js";
import { parseThinking, stripThinking } from "./format/thinking.js";
import { replyFinalCard, getTenantAccessToken } from "./feishu.js";
import type { ReplyContext } from "./feishu.js";
import type { CompleteOptions, FlushControllerOptions } from "./streaming.js";

// ── API 常量 ──────────────────────────────────────────────────

const CARDKIT_BASE = "https://open.feishu.cn/open-apis/cardkit/v1";

// ── 状态机 ──────────────────────────────────────────────────

type Phase = "idle" | "creating" | "streaming" | "completed" | "aborted";

// ── FlushController（从 streaming.ts 导入的接口） ─────────────

/**
 * 刷新控制器接口，与 streaming.ts 中的 FlushController 对齐。
 * CardKit 模式内部创建实例，避免跨模块耦合。
 */
class FlushController {
  private buffer = "";
  private sentLength = 0;
  private flushing = false;
  private stopped = false;
  private lastFlushTime = 0;
  private lastAppendTime = 0;
  private minIntervalMs: number;
  private onFlush: (content: string) => Promise<void>;
  private onError?: (error: unknown) => void;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private gapCheckTimer: ReturnType<typeof setInterval> | null = null;

  private static readonly LONG_GAP_MS = 2000;
  private static readonly GAP_CHECK_INTERVAL = 500;

  constructor(options: FlushControllerOptions) {
    this.minIntervalMs = options.minIntervalMs;
    this.onFlush = options.onFlush;
    this.onError = options.onError;
  }

  append(text: string): void {
    if (this.stopped) return;
    this.buffer += text;
    this.lastAppendTime = Date.now();
    this.scheduleFlush();
  }

  start(): void {
    this.lastAppendTime = Date.now();
    this.lastFlushTime = Date.now();
    this.gapCheckTimer = setInterval(() => this.checkLongGap(), FlushController.GAP_CHECK_INTERVAL);
  }

  stop(): void {
    this.stopped = true;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.gapCheckTimer) { clearInterval(this.gapCheckTimer); this.gapCheckTimer = null; }
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.stopped) return;
    const elapsed = Date.now() - this.lastFlushTime;
    const delay = Math.max(0, this.minIntervalMs - elapsed);
    this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.doFlush(); }, delay);
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
      if (this.onError) this.onError(error);
      this.stop();
      return;
    } finally {
      this.flushing = false;
    }
    if (!this.stopped && this.buffer.length > this.sentLength) this.scheduleFlush();
  }

  private checkLongGap(): void {
    if (this.stopped || this.flushing) return;
    if (Date.now() - this.lastAppendTime > FlushController.LONG_GAP_MS) {
      if (this.buffer.length > this.sentLength) void this.doFlush();
    }
  }
}

// ── 控制器 ──────────────────────────────────────────────────

export class CardKitController {
  private phase: Phase = "idle";
  private client: lark.Client;
  private appId: string;
  private appSecret: string;
  private rootMsgId: string;
  private cardTitle: string;
  private thinkingEnabled: boolean;
  private context: ReplyContext;

  private token = "";
  private cardId: string | null = null;
  private readonly streamElementId = "streaming_content";
  private sequence = 0;

  private flushCtrl: FlushController;

  constructor(params: {
    client: lark.Client;
    appId: string;
    appSecret: string;
    rootMsgId: string;
    cardTitle: string;
    thinkingEnabled: boolean;
    context: ReplyContext;
    intervalMs: number;
  }) {
    this.client = params.client;
    this.appId = params.appId;
    this.appSecret = params.appSecret;
    this.rootMsgId = params.rootMsgId;
    this.cardTitle = params.cardTitle;
    this.thinkingEnabled = params.thinkingEnabled;
    this.context = params.context;

    this.flushCtrl = new FlushController({
      minIntervalMs: params.intervalMs,
      onFlush: (content) => this.performFlush(content),
      onError: (error) => {
        console.error("[CARDKIT] Flush failed:", error);
      },
    });
  }

  // ── 公共方法 ──────────────────────────────────────────────

  /**
   * 追加文本内容（thinking 或正文）
   * 首次调用时自动创建卡片
   */
  async append(text: string): Promise<void> {
    if (this.phase === "completed" || this.phase === "aborted") return;

    await this.ensureCardCreated();
    if (this.phase !== "streaming") return;

    this.flushCtrl.append(text);
  }

  /**
   * 完成：写入最终内容，关闭流式模式
   */
  async complete(finalContent: string, options?: CompleteOptions): Promise<void> {
    if (this.phase === "completed" || this.phase === "aborted") return;

    this.flushCtrl.stop();

    // 卡片未创建成功，降级为普通消息
    if (!this.cardId) {
      await replyFinalCard(
        this.client, this.context.chatId, this.rootMsgId,
        finalContent, this.context, options,
      );
      this.phase = "completed";
      return;
    }

    // 构建最终内容
    let content = finalContent;
    if (options?.metadata) {
      content += `\n\n---\n${options.metadata}`;
    }
    const optimized = optimizeForCard(content);

    // 构建 thinking 可折叠区域
    const extraElements: any[] = [];
    if (options?.thinking) {
      extraElements.push({
        tag: "column_set",
        flex_mode: "none",
        background_style: "default",
        columns: [{
          tag: "column",
          width: "weighted",
          weight: 1,
          elements: [{
            tag: "markdown",
            content: `💭 **思考过程**\n${options.thinking}`,
          }],
        }],
        fold_flag: "fold",
      });
      extraElements.push({ tag: "hr" });
    }

    try {
      const finalCardJson = this.buildFinalCard(optimized, extraElements);
      this.sequence++;
      await this.updateCard(finalCardJson);
    } catch (error) {
      console.error("[CARDKIT] Final update failed, sending as new message:", error);
      await replyFinalCard(
        this.client, this.context.chatId, this.rootMsgId,
        finalContent, this.context, options,
      );
    }

    this.phase = "completed";
  }

  /**
   * 中断
   */
  async abort(message: string): Promise<void> {
    if (this.phase === "completed" || this.phase === "aborted") return;

    this.flushCtrl.stop();
    this.phase = "aborted";

    if (!this.cardId) return;

    const optimized = optimizeForCard(message);
    try {
      const abortCardJson = this.buildFinalCard(optimized);
      this.sequence++;
      await this.updateCard(abortCardJson);
    } catch (error) {
      console.error("[CARDKIT] Abort update failed:", error);
    }
  }

  /**
   * 卡片是否创建失败（用于降级判断）
   */
  isDisabled(): boolean {
    return this.phase === "aborted" && !this.cardId;
  }

  // ── 卡片创建（懒触发） ────────────────────────────────────

  private async ensureCardCreated(): Promise<void> {
    if (this.phase === "streaming") return;
    if (this.phase === "creating") {
      // 等待并发创建完成
      while (this.phase === "creating") {
        await new Promise(r => setTimeout(r, 50));
      }
      return;
    }

    this.phase = "creating";
    try {
      await this.createCardEntity();
      await this.sendCardMessage();
      this.flushCtrl.start();
      this.phase = "streaming";
    } catch (error) {
      console.error("[CARDKIT] Card creation failed:", error);
      this.phase = "aborted";
    }
  }

  /**
   * 创建 CardKit 卡片实体
   *
   * POST /cardkit/v1/cards
   * body: { type: "card_json", data: "<JSON 2.0 string>" }
   */
  private async createCardEntity(): Promise<void> {
    this.token = await getTenantAccessToken(this.appId, this.appSecret);

    const cardJson: any = {
      schema: "2.0",
      config: { streaming_mode: true },
      body: {
        elements: [{
          tag: "markdown",
          content: "⏳ 思考中...",
          element_id: this.streamElementId,
        }],
      },
    };

    if (this.cardTitle) {
      cardJson.header = {
        title: { tag: "plain_text", content: this.cardTitle },
        template: "blue",
      };
    }

    const res = await fetch(`${CARDKIT_BASE}/cards`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "card_json",
        data: JSON.stringify(cardJson),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[CARDKIT] Create card failed: ${res.status} ${errText.slice(0, 200)}`);
      throw new Error(`CardKit create failed: ${res.status}`);
    }

    const data = await res.json() as any;
    this.cardId = data.data?.card_id;

    if (!this.cardId) {
      throw new Error("CardKit: no card_id in response");
    }

    console.error(`[CARDKIT] Card created: ${this.cardId}`);
  }

  /**
   * 通过 IM 消息 API 发送卡片到聊天
   *
   * content: { type: "card", data: { card_id: "..." } }
   */
  private async sendCardMessage(): Promise<void> {
    await (this.client.im.message as any).reply({
      path: { message_id: this.rootMsgId },
      data: {
        content: JSON.stringify({ type: "card", data: { card_id: this.cardId } }),
        msg_type: "interactive",
      },
    });
  }

  // ── 流式更新 ──────────────────────────────────────────────

  /**
   * 刷新卡片内容（打字机效果）
   *
   * PUT /cardkit/v1/cards/{id}/elements/{element_id}/content
   * body: { content, sequence }
   */
  private async performFlush(content: string): Promise<void> {
    if (this.phase !== "streaming" || !this.cardId) return;

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

    this.sequence++;
    const res = await fetch(
      `${CARDKIT_BASE}/cards/${this.cardId}/elements/${this.streamElementId}/content`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: truncated,
          sequence: this.sequence,
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[CARDKIT] Stream update failed: ${res.status} ${errText.slice(0, 200)}`);
      throw new Error(`CardKit stream update failed: ${res.status}`);
    }
  }

  // ── 卡片更新 ──────────────────────────────────────────────

  /**
   * 更新整个卡片
   *
   * PUT /cardkit/v1/cards/{id}
   * body: { card: { type: "card_json", data: "<JSON>" }, sequence }
   */
  private async updateCard(cardJson: any): Promise<void> {
    const res = await fetch(`${CARDKIT_BASE}/cards/${this.cardId}`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        card: { type: "card_json", data: JSON.stringify(cardJson) },
        sequence: this.sequence,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[CARDKIT] Card update failed: ${res.status} ${errText.slice(0, 200)}`);
      throw new Error(`CardKit card update failed: ${res.status}`);
    }
  }

  // ── 卡片构建 ──────────────────────────────────────────────

  private buildFinalCard(content: string, extraElements?: any[]): any {
    const cardJson: any = {
      schema: "2.0",
      config: { streaming_mode: false },
      body: {
        elements: [
          ...(extraElements ?? []),
          {
            tag: "markdown",
            content,
            element_id: this.streamElementId,
          },
        ],
      },
    };

    if (this.cardTitle) {
      cardJson.header = {
        title: { tag: "plain_text", content: this.cardTitle },
        template: "blue",
      };
    }

    return cardJson;
  }
}
