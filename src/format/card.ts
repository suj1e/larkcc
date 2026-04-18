/**
 * 飞书卡片处理模块
 */

import type { Client } from "@larksuiteoapi/node-sdk";
import { sanitizeContent, formatWarnings } from "./sanitize.js";
import { formatDuration } from "./duration.js";

// ── Header 构建器 ──────────────────────────────────────────

export interface HeaderOptions {
  title: string;
  subtitle?: string;
  template?: string;
  iconImgKey?: string;
  iconToken?: string;
  tags?: Array<{ text: string; color: string }>;
}

const DEFAULT_ICON_TOKEN = "larkcommunity_colorful";

export function buildHeader(options: HeaderOptions): any {
  const header: any = {
    title: { tag: "plain_text", content: options.title },
    template: options.template ?? "blue",
  };

  if (options.subtitle) {
    header.subtitle = { tag: "plain_text", content: options.subtitle };
  }

  if (options.iconImgKey) {
    header.icon = { tag: "custom_icon", img_key: options.iconImgKey };
  } else {
    header.icon = {
      tag: "standard_icon",
      token: options.iconToken ?? DEFAULT_ICON_TOKEN,
    };
  }

  if (options.tags?.length) {
    header.text_tag_list = options.tags.slice(0, 3).map(t => ({
      tag: "text_tag",
      text: { tag: "plain_text", content: t.text },
      color: t.color,
    }));
  }

  return header;
}

// ── Footer 构建器 ──────────────────────────────────────────

export interface FooterStats {
  inputTokens?: number;
  outputTokens?: number;
  toolCount?: number;
  duration?: number;
}

export function buildFooterMarkdown(stats: FooterStats): string | null {
  const parts: string[] = [];

  if (stats.inputTokens != null) {
    parts.push(`📥 ${stats.inputTokens.toLocaleString()}`);
  }
  if (stats.outputTokens != null) {
    parts.push(`📤 ${stats.outputTokens.toLocaleString()}`);
  }
  if (stats.toolCount != null && stats.toolCount > 0) {
    parts.push(`🔧 ${stats.toolCount}`);
  }

  if (parts.length === 0) return null;

  return `<font color='grey'>${parts.join(" · ")}</font>`;
}

/**
 * 构建 Markdown 卡片
 */
export function buildMarkdownCard(markdown: string, warnings: string[] = []): object {
  let content = markdown;
  if (warnings.length > 0) {
    content += formatWarnings(warnings);
  }

  return {
    schema: "2.0",
    body: {
      elements: [
        {
          tag: "markdown",
          content,
        },
      ],
    },
  };
}

/**
 * 构建并发送 Markdown 卡片消息
 * 这是一个辅助函数，用于统一处理卡片消息的发送
 */
export async function sendMarkdownCardMessage(
  client: Client,
  chatId: string,
  content: string,
  options?: {
    rootMsgId?: string;
    reply?: boolean;
  }
): Promise<void> {
  // 清理内容
  const { content: sanitizedContent, warnings } = sanitizeContent(content);

  // 构建卡片
  const card = buildMarkdownCard(sanitizedContent, warnings);

  // 发送
  if (options?.reply && options.rootMsgId) {
    await client.im.message.reply({
      path: { message_id: options.rootMsgId },
      data: {
        msg_type: "interactive",
        content: JSON.stringify(card),
      },
    });
  } else {
    await client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      },
    });
  }
}

