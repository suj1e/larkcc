/**
 * 飞书卡片处理模块
 */

import type { Client } from "@larksuiteoapi/node-sdk";
import { sanitizeContent, formatWarnings } from "./sanitize.js";

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

