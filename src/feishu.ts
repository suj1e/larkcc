import * as lark from "@larksuiteoapi/node-sdk";

export function createLarkClient(appId: string, appSecret: string) {
  return new lark.Client({ appId, appSecret });
}

export function createWSClient(appId: string, appSecret: string) {
  return new lark.WSClient({ appId, appSecret });
}

// ── 消息发送 ─────────────────────────────────────────────────

export async function sendText(
  client: lark.Client,
  chatId: string,
  text: string
): Promise<string> {
  const res = await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
  });
  return res.data?.message_id ?? "";
}

export async function updateText(
  client: lark.Client,
  msgId: string,
  text: string
): Promise<void> {
  await client.im.message.patch({
    path: { message_id: msgId },
    data: { content: JSON.stringify({ text }) },
  });
}

// 最终回复：富文本卡片，Markdown + 代码高亮
export async function sendFinalCard(
  client: lark.Client,
  chatId: string,
  markdown: string
): Promise<void> {
  const card = buildMarkdownCard(markdown);
  await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify(card),
    },
  });
}

// 工具调用卡片（running 状态）
export async function sendToolCard(
  client: lark.Client,
  chatId: string,
  label: string,
  detail: string,
  status: "running" | "done" | "error" = "running",
): Promise<string> {
  const statusIcon = status === "running" ? "⏳ 进行中..." : status === "done" ? "✅ 完成" : "❌ 失败";
  const content = `${label}\n\`${detail}\`\n${statusIcon}`;
  const card = buildMarkdownCard(content);
  const res = await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify(card),
    },
  });
  return res.data?.message_id ?? "";
}

// 工具完成：更新卡片，完整显示结果（纯 Markdown 代码块，不用 <details>）
export async function updateToolCard(
  client: lark.Client,
  msgId: string,
  label: string,
  detail: string,
  resultPreview: string
): Promise<void> {
  let content = `${label}\n\`${detail}\`\n✅ 完成`;
  if (resultPreview.trim()) {
    content += `\n\`\`\`\n${resultPreview}\n\`\`\``;
  }
  const card = buildMarkdownCard(content);
  await client.im.message.patch({
    path: { message_id: msgId },
    data: { content: JSON.stringify(card) },
  });
}

// ── 卡片构建 ─────────────────────────────────────────────────

function buildMarkdownCard(markdown: string) {
  return {
    schema: "2.0",
    body: {
      elements: [
        {
          tag: "markdown",
          content: markdown,
        },
      ],
    },
  };
}