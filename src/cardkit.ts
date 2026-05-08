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
import { optimizeForCard, truncateSafely } from "./format/card-optimize.js";
import { stripThinking } from "./format/thinking.js";
import { buildThinkingPanel, THINKING_OVERFLOW_TRUNCATE, formatDuration } from "./format/duration.js";
import { buildHeader, buildFooterMarkdown } from "./format/card.js";
import { replyFinalCard, prepareOverflowContext, createOverflowDocument, registerDocument, cleanupOldDocuments } from "./feishu.js";
import type { ReplyContext, CompletionOptions } from "./feishu.js";
import type { FlushControllerOptions } from "./streaming.js";
import { FlushController } from "./streaming.js";
import { countTables } from "./format/index.js";

// ── 常量 ──────────────────────────────────────────────────

const TRUNCATE_LIMIT = 4000;

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
  private apiMutex: Promise<void> = Promise.resolve();

  private flushCtrl: FlushController;

  private headerIconImgKey?: string;

  constructor(params: {
    client: lark.Client;
    rootMsgId: string;
    cardTitle: string;
    thinkingEnabled: boolean;
    context: ReplyContext;
    intervalMs: number;
    headerIconImgKey?: string;
  }) {
    this.client = params.client;
    this.rootMsgId = params.rootMsgId;
    this.cardTitle = params.cardTitle;
    this.thinkingEnabled = params.thinkingEnabled;
    this.context = params.context;
    this.headerIconImgKey = params.headerIconImgKey;

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
   * 互斥执行 API 调用，防止 sequence 乱序
   */
  private async withMutex<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.apiMutex;
    let resolve: () => void;
    this.apiMutex = new Promise<void>(r => { resolve = r; });
    await prev;
    try {
      return await fn();
    } catch (err) {
      console.error("[CARDKIT] withMutex error:", err);
      throw err;
    } finally {
      resolve!();
    }
  }

  /**
   * 两步关闭：关闭 streaming_mode → 更新最终卡片内容（对齐 openclaw-lark）
   */
  private async closeAndFinalize(cardJson: any): Promise<void> {
    await this.withMutex(async () => {
      this.sequence++;
      await this.closeStreamingMode();
      this.sequence++;
      await this.updateCard(cardJson);
    });
  }

  /**
   * 设置工具状态文本（拼接在流式内容前缀）
   * 传空字符串清除状态
   */
  async updateStatus(text: string): Promise<void> {
    this.statusText = text;
    if (this.phase === "completed" || this.phase === "aborted") return;
    await this.ensureCardCreated();
    if (this.phase === "streaming") {
      await this.flushCtrl.flush();
    }
  }

  /**
   * 清除工具状态
   */
  async clearStatus(): Promise<void> {
    this.statusText = "";
    if (this.phase === "streaming") {
      await this.flushCtrl.flush();
    }
  }

  /**
   * 完成：关闭 streaming_mode，写入最终内容
   */
  async complete(finalContent: string, options?: CompletionOptions): Promise<void> {
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

    // 构建最终内容（CardKit 模式下不拼接 metadata，header + footer 已覆盖）
    let content = finalContent;

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
    const extraElements = this.buildThinkingElements(options?.thinking, options?.reasoningElapsedMs);
    try {
      const finalCardJson = this.buildFinalCard(optimized, extraElements, options?.stats);
      await this.closeAndFinalize(finalCardJson);
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
   * 中断：保留已有内容，构建完整终态卡片（对齐 openclaw-lark）
   */
  async abort(options?: { content?: string; thinking?: string; reasoningElapsedMs?: number }): Promise<void> {
    if (this.phase === "completed" || this.phase === "aborted") return;

    this.flushCtrl.stop();
    this.statusText = "";
    this.phase = "aborted";

    if (!this.cardId) return;

    const text = options?.content || "⏹ 任务已中断";
    const optimized = optimizeForCard(text);
    const extraElements = this.buildThinkingElements(options?.thinking, options?.reasoningElapsedMs);

    try {
      const abortCardJson = this.buildAbortCard(optimized, extraElements);
      await this.closeAndFinalize(abortCardJson);
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

  /**
   * 构建中止态卡片（grey header）
   */
  private buildAbortCard(content: string, extraElements?: any[]): any {
    const elements: any[] = [
      ...(extraElements ?? []),
      {
        tag: "markdown",
        content,
        element_id: this.streamElementId,
      },
    ];

    const cardJson: any = {
      schema: "2.0",
      config: {
        wide_screen_mode: true,
        width_mode: "fill",
      },
      body: { elements },
    };

    if (this.cardTitle) {
      cardJson.header = buildHeader({
        title: this.cardTitle,
        subtitle: "已停止",
        template: "grey",
        iconImgKey: this.headerIconImgKey,
      });
    }

    return cardJson;
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
        width_mode: "fill",
      },
      summary: {
        content: "🤔 Claude 正在思考...",
        i18n_content: {
          zh_cn: "🤔 Claude 正在思考...",
          en_us: "🤔 Claude is thinking...",
        },
      },
      body: {
        elements: [
          {
            tag: "markdown",
            content: "",
            element_id: this.streamElementId,
          },
        ],
      },
    };

    if (this.cardTitle) {
      cardJson.header = buildHeader({
        title: this.cardTitle,
        subtitle: "正在思考...",
        template: "indigo",
        iconImgKey: this.headerIconImgKey,
      });
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
    if (!this.thinkingEnabled) {
      displayContent = stripThinking(content);
    }

    // 拼接工具状态前缀
    if (this.statusText) {
      displayContent = `${this.statusText}\n\n${displayContent}`;
    }

    if (!displayContent.trim()) return;

    // 先截断再优化，避免对超长内容做无用正则处理
    const preTruncated = displayContent.length > TRUNCATE_LIMIT
      ? truncateSafely(displayContent, TRUNCATE_LIMIT)
      : displayContent;
    const optimized = optimizeForCard(preTruncated);

    await this.withMutex(async () => {
      this.sequence++;
      const res = await this.client.cardkit.v1.cardElement.content({
        path: { card_id: this.cardId!, element_id: this.streamElementId },
        data: { content: optimized, sequence: this.sequence },
      });

      const err = checkCardKitError(res, "Stream update");
      if (err) {
        console.error(`[CARDKIT] ${err.message}`);
        throw err;
      }
    });
  }

  // ── 溢出处理 ──────────────────────────────────────────────

  /**
   * 内容溢出时写入云文档，卡片显示文档链接
   */
  private async handleOverflow(
    rawContent: string,
    options?: CompletionOptions,
  ): Promise<void> {
    try {
      // 先更新卡片显示"正在生成文档..."
      const waitingCardJson = this.buildFinalCard("📝 内容较长，正在写入云文档...");
      await this.withMutex(async () => {
        this.sequence++;
        await this.updateCard(waitingCardJson);
      });

      const { token, title, originalMessage, meta } = await prepareOverflowContext(
        this.client, this.rootMsgId, this.context,
      );

      const { docUrl, docId } = await createOverflowDocument(token, title, rawContent, originalMessage, meta);

      registerDocument(docId, this.context.profile);

      let cardContent = `📝 内容较长，已写入云文档：[${title}](${docUrl})`;

      // 清理旧文档
      const cleanupConfig = this.context.overflow.document.cleanup;
      await cleanupOldDocuments(token, cleanupConfig.max_docs, this.context.profile);

      const extraElements = this.buildThinkingElements(options?.thinking, options?.reasoningElapsedMs);
      const finalCardJson = this.buildFinalCard(cardContent, extraElements, options?.stats);

      await this.closeAndFinalize(finalCardJson);
    } catch (error) {
      console.error("[CARDKIT] Overflow document failed, truncating:", error);
      const optimized = optimizeForCard(rawContent);
      const truncated = optimized.length > TRUNCATE_LIMIT
        ? truncateSafely(optimized, TRUNCATE_LIMIT)
        : optimized;
      const finalCardJson = this.buildFinalCard(truncated);
      await this.closeAndFinalize(finalCardJson);
    }
  }

  // ── CardKit API helpers（使用 SDK） ──────────────────────

  /**
   * 关闭 streaming_mode 并更新 summary（对齐 openclaw-lark 两步关闭的第一步）
   */
  private async closeStreamingMode(summaryContent?: string): Promise<void> {
    const summary = summaryContent ?? "✅ Claude · 对话完成";
    const res = await this.client.cardkit.v1.card.settings({
      path: { card_id: this.cardId! },
      data: {
        settings: JSON.stringify({
          streaming_mode: false,
          summary: {
            content: summary,
            i18n_content: { zh_cn: summary, en_us: summary },
          },
        }),
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
  private buildFinalCard(content: string, extraElements?: any[], stats?: CompletionOptions['stats']): any {
    const elements: any[] = [
      ...(extraElements ?? []),
      {
        tag: "markdown",
        content,
        element_id: this.streamElementId,
      },
    ];

    const footer = buildFooterMarkdown({
      inputTokens: stats?.inputTokens,
      outputTokens: stats?.outputTokens,
      toolCount: stats?.toolCount,
      duration: stats?.duration,
    });
    if (footer) {
      elements.push({ tag: "hr" }, { tag: "markdown", content: footer, text_size: "notation" });
    }

    const cardJson: any = {
      schema: "2.0",
      config: {
        wide_screen_mode: true,
        width_mode: "fill",
      },
      body: { elements },
    };

    if (this.cardTitle) {
      const tags: Array<{ text: string; color: string }> = [];
      if (stats?.model) {
        tags.push({ text: stats.model, color: "blue" });
      }
      const totalTokens = (stats?.inputTokens ?? 0) + (stats?.outputTokens ?? 0);
      if (totalTokens > 0) {
        tags.push({ text: `${totalTokens.toLocaleString()} tokens`, color: "turquoise" });
      }
      if (stats?.duration != null) {
        tags.push({ text: formatDuration(stats.duration), color: "orange" });
      }

      cardJson.header = buildHeader({
        title: this.cardTitle,
        subtitle: "对话完成",
        template: "green",
        iconImgKey: this.headerIconImgKey,
        tags,
      });
    }

    return cardJson;
  }

  /**
   * 构建 thinking 折叠面板（委托共享函数）
   */
  private buildThinkingElements(thinking?: string, reasoningElapsedMs?: number): any[] {
    if (!thinking) return [];
    return buildThinkingPanel({ thinking, reasoningElapsedMs });
  }

}

