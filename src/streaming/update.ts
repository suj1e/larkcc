/**
 * 流式卡片模块（Update 模式）
 *
 * 使用飞书消息 message.patch API 模拟流式输出。
 *
 * - update: message.patch 模拟流式（无需额外权限）
 * - none: 禁用流式
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { optimizeForCard, truncateSafely } from "../format/card-optimize.js";
import { STREAMING_TRUNCATE } from "../format/duration.js";
import { parseThinking, stripThinking } from "../format/thinking.js";
import type { StreamingConfig } from "../config.js";
import type { ReplyContext, CompletionOptions, CardBuildOptions } from "../feishu.js";
import { replyFinalCard, buildMarkdownCard } from "../feishu.js";
import { FlushController } from "./types.js";
import type { IStreamingCard } from "./types.js";

const TRUNCATE_LIMIT = STREAMING_TRUNCATE;

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
    const truncated = optimized.length > TRUNCATE_LIMIT ? truncateSafely(optimized, TRUNCATE_LIMIT) : optimized;

    const card = buildMarkdownCard(truncated, [], { ...cardOptions, cardTitle: this.cardTitle });
    await this.client.im.message.patch({
      path: { message_id: this.msgId },
      data: { content: JSON.stringify(card) },
    });
  }

  async complete(finalContent: string, options?: CompletionOptions): Promise<void> {
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
