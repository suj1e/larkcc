/**
 * CardKit 流式卡片控制器
 *
 * 单卡片架构，对齐飞书官方 OpenClaw 方案。
 * 全程只有一个卡片消息，通过 CardKit API 实现打字机效果。
 * 工具调用状态作为前缀拼接在流式内容中，thinking 和最终回答在同一卡片内展示。
 *
 * API 调用链参考飞书官方 openclaw-lark 项目：
 * https://github.com/larksuite/openclaw-lark
 *
 * 状态机：idle → creating → streaming → completed / aborted
 *
 * API 调用链（使用 SDK CardKit 客户端）：
 * 1. client.cardkit.v1.card.create()   → 创建卡片实体
 * 2. im.message.reply({ card_id })     → 发送消息引用卡片
 * 3. client.cardkit.v1.cardElement.content()  → 流式打字机
 * 4. client.cardkit.v1.card.settings() → 关闭 streaming_mode
 * 5. client.cardkit.v1.card.update()   → 最终更新卡片内容
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { optimizeForCard } from "./format/card-optimize.js";
import { parseThinking, stripThinking } from "./format/thinking.js";
import { replyFinalCard, prepareOverflowContext, createOverflowDocument, registerDocument } from "./feishu.js";
import type { ReplyContext } from "./feishu.js";
import type { CompleteOptions, FlushControllerOptions } from "./streaming.js";
import { FlushController } from "./streaming.js";
import { countTables } from "./format/index.js";

// ── 常量 ──────────────────────────────────────────────────

const TRUNCATE_LIMIT = 4000;
const THINKING_OVERFLOW_TRUNCATE = 500;

// ── 状态机 ──────────────────────────────────────────────────

type Phase = "idle" | "creating" | "streaming" | "completed" | "aborted";

// ── CardKit API 错误 ──────────────────────────────────────

class CardKitApiError extends Error {
  readonly code: number;

  constructor(code: number, msg: string, context: string) {
    super(`${context} failed (${code}): ${msg}`);
    this.name = "CardKitApiError";
    this.code = code;
  }

  get isRateLimit(): boolean {
    return this.code === 230020;
  }

  get isTableLimit(): boolean {
    return this.code === 230099 || this.code === 11310;
  }
}

/**
 * 检查 SDK 响应中的错误码，返回 CardKitApiError 或 null
 */
function checkCardKitError(response: any, context: string): CardKitApiError | null {
  if (response?.code !== undefined && response.code !== 0) {
    return new CardKitApiError(response.code, response.msg ?? "unknown", context);
  }
  return null;
}

// ── 控制器 ──────────────────────────────────────────────────

export class CardKitController {
  private phase: Phase = "idle";
  private client: lark.Client;
  private rootMsgId: string;
  private cardTitle: string;
  private thinkingEnabled: boolean;
  private context: ReplyContext;

  private cardId: string | null = null;
  private readonly streamElementId = "streaming_content";
  private sequence = 0;
  private statusText = "";

  private flushCtrl: FlushController;

  constructor(params: {
    client: lark.Client;
    rootMsgId: string;
    cardTitle: string;
    thinkingEnabled: boolean;
    context: ReplyContext;
    intervalMs: number;
  }) {
    this.client = params.client;
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
   * 设置工具状态文本（拼接在流式内容前缀）
   * 传空字符串清除状态
   */
  async updateStatus(text: string): Promise<void> {
    this.statusText = text;
  }

  /**
   * 清除工具状态
   */
  async clearStatus(): Promise<void> {
    this.statusText = "";
  }

  /**
   * 完成：关闭 streaming_mode，写入最终内容
   */
  async complete(finalContent: string, options?: CompleteOptions): Promise<void> {
    if (this.phase === "completed") return;

    this.flushCtrl.stop();
    this.statusText = "";

    // 卡片未创建成功或创建失败，降级为普通消息
    if (!this.cardId || this.phase === "aborted") {
      this.phase = "completed";
      const fallbackOptions = { ...options, metadata: this.appendFallbackHint(options?.metadata) };
      await replyFinalCard(
        this.client, this.context.chatId, this.rootMsgId,
        finalContent, this.context, fallbackOptions,
      );
      return;
    }

    // 构建最终内容（含 metadata）
    let content = finalContent;
    if (options?.metadata) {
      content += `\n\n---\n${options.metadata}`;
    }

    // ── 溢出检查（在 optimizeForCard 之前，避免溢出路径的无用计算） ──
    const threshold = this.context.overflow.document.threshold;
    const tableCount = countTables(finalContent);
    const maxTables = this.context.card_table?.max_tables_per_card ?? 5;

    if (content.length > threshold || tableCount > maxTables) {
      await this.handleOverflow(finalContent, options);
      this.phase = "completed";
      return;
    }

    // ── 正常完成：两步关闭（对齐 openclaw-lark） ──
    const optimized = optimizeForCard(content);
    const extraElements = this.buildThinkingElements(options?.thinking);
    try {
      // Step 1: 关闭 streaming_mode
      this.sequence++;
      await this.closeStreamingMode();

      // Step 2: 更新最终卡片内容
      this.sequence++;
      const finalCardJson = this.buildFinalCard(optimized, extraElements);
      await this.updateCard(finalCardJson);
    } catch (error) {
      console.error("[CARDKIT] Final update failed, sending as new message:", error);
      const fallbackOptions = { ...options, metadata: this.appendFallbackHint(options?.metadata) };
      await replyFinalCard(
        this.client, this.context.chatId, this.rootMsgId,
        finalContent, this.context, fallbackOptions,
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
      await this.closeStreamingMode();
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

  /**
   * 在现有 metadata 后追加降级提示
   */
  private appendFallbackHint(existing?: string): string {
    const hint = "⚠️ 卡片模式不可用，已降级为普通消息";
    return existing ? `${existing}\n${hint}` : hint;
  }

  // ── 卡片创建（懒触发） ────────────────────────────────────

  private async ensureCardCreated(): Promise<void> {
    if (this.phase === "streaming") return;
    if (this.phase === "creating") {
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
   * 创建 CardKit 卡片实体（使用 SDK）
   *
   * 对齐 openclaw-lark：
   * - config: streaming_mode, wide_screen_mode, update_multi
   * - summary: 对象格式 { content, i18n_content }
   * - 单元素架构：只有 streaming_content，工具状态作为前缀拼接
   */
  private async createCardEntity(): Promise<void> {
    const cardJson: any = {
      schema: "2.0",
      config: {
        streaming_mode: true,
        wide_screen_mode: true,
        update_multi: true,
      },
      summary: {
        content: "思考中...",
        i18n_content: {
          zh_cn: "思考中...",
          en_us: "Thinking...",
        },
      },
      body: {
        elements: [
          {
            tag: "markdown",
            content: "⏳ 思考中...",
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

    const res = await this.client.cardkit.v1.card.create({
      data: {
        type: "card_json",
        data: JSON.stringify(cardJson),
      },
    });

    const err = checkCardKitError(res, "Create card");
    if (err) {
      console.error(`[CARDKIT] ${err.message}`);
      throw err;
    }

    this.cardId = (res as any).data?.card_id;

    if (!this.cardId) {
      console.error(`[CARDKIT] Create card response: ${JSON.stringify(res).slice(0, 500)}`);
      throw new Error("CardKit: no card_id in response");
    }

    console.error(`[CARDKIT] Card created: ${this.cardId}`);
  }

  /**
   * 通过 IM 消息 API 发送卡片到聊天
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
   * 刷新卡片内容（打字机效果，使用 SDK）
   * 工具状态作为前缀拼接在内容前
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

    // 拼接工具状态前缀
    if (this.statusText) {
      displayContent = `${this.statusText}\n\n${displayContent}`;
    }

    if (!displayContent.trim()) return;

    const optimized = optimizeForCard(displayContent);
    const truncated = optimized.length > TRUNCATE_LIMIT
      ? optimized.slice(0, TRUNCATE_LIMIT) + "\n\n..."
      : optimized;

    this.sequence++;
    const res = await this.client.cardkit.v1.cardElement.content({
      path: { card_id: this.cardId!, element_id: this.streamElementId },
      data: { content: truncated, sequence: this.sequence },
    });

    const err = checkCardKitError(res, "Stream update");
    if (err) {
      console.error(`[CARDKIT] ${err.message}`);
      throw err;
    }
  }

  // ── 溢出处理 ──────────────────────────────────────────────

  /**
   * 内容溢出时写入云文档，卡片显示文档链接
   */
  private async handleOverflow(
    rawContent: string,
    options?: CompleteOptions,
  ): Promise<void> {
    try {
      const { token, title, originalMessage, meta } = await prepareOverflowContext(
        this.client, this.rootMsgId, this.context,
      );

      const { docUrl, docId } = await createOverflowDocument(token, title, rawContent, originalMessage, meta);
      registerDocument(docId, this.context.profile);

      let cardContent = `📝 内容较长，已写入云文档：[${title}](${docUrl})`;
      if (options?.metadata) {
        cardContent += `\n\n---\n${options.metadata}`;
      }

      const extraElements = this.buildThinkingElements(options?.thinking);
      const finalCardJson = this.buildFinalCard(cardContent, extraElements);

      // 两步关闭
      this.sequence++;
      await this.closeStreamingMode();
      this.sequence++;
      await this.updateCard(finalCardJson);
    } catch (error) {
      console.error("[CARDKIT] Overflow document failed, truncating:", error);
      const optimized = optimizeForCard(rawContent);
      const truncated = optimized.length > TRUNCATE_LIMIT
        ? optimized.slice(0, TRUNCATE_LIMIT) + "\n\n..."
        : optimized;
      const finalCardJson = this.buildFinalCard(truncated);
      this.sequence++;
      await this.closeStreamingMode();
      this.sequence++;
      await this.updateCard(finalCardJson);
    }
  }

  // ── CardKit API helpers（使用 SDK） ──────────────────────

  /**
   * 关闭 streaming_mode（对齐 openclaw-lark 两步关闭的第一步）
   */
  private async closeStreamingMode(): Promise<void> {
    const res = await this.client.cardkit.v1.card.settings({
      path: { card_id: this.cardId! },
      data: {
        settings: JSON.stringify({ streaming_mode: false }),
        sequence: this.sequence,
      },
    });

    const err = checkCardKitError(res, "Close streaming");
    if (err) console.error(`[CARDKIT] ${err.message}`);
  }

  /**
   * 更新整个卡片内容（使用 SDK）
   */
  private async updateCard(cardJson: any): Promise<void> {
    const res = await this.client.cardkit.v1.card.update({
      path: { card_id: this.cardId! },
      data: {
        card: { type: "card_json", data: JSON.stringify(cardJson) },
        sequence: this.sequence,
      },
    });

    const err = checkCardKitError(res, "Card update");
    if (err) {
      console.error(`[CARDKIT] ${err.message}`);
      throw err;
    }
  }

  // ── 卡片构建 ──────────────────────────────────────────────

  /**
   * 构建最终卡片 JSON
   */
  private buildFinalCard(content: string, extraElements?: any[]): any {
    const cardJson: any = {
      schema: "2.0",
      config: {
        wide_screen_mode: true,
      },
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

  /**
   * 构建 thinking 可折叠区域
   */
  private buildThinkingElements(thinking?: string): any[] {
    if (!thinking) return [];

    const truncatedThinking = thinking.length > THINKING_OVERFLOW_TRUNCATE
      ? thinking.slice(0, THINKING_OVERFLOW_TRUNCATE) + "\n..."
      : thinking;

    return [
      {
        tag: "column_set",
        flex_mode: "none",
        background_style: "default",
        columns: [{
          tag: "column",
          width: "weighted",
          weight: 1,
          elements: [{
            tag: "markdown",
            content: `💭 **思考过程**\n${truncatedThinking}`,
          }],
        }],
        fold_flag: "fold",
      },
      { tag: "hr" },
    ];
  }

}
