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
    data: { msg_type: "text", content: JSON.stringify({ text }) },
  });
}

// 最终用卡片替换，支持 Markdown + 代码高亮 + 折叠
export async function updateCard(
  client: lark.Client,
  msgId: string,
  markdown: string
): Promise<void> {
  const card = buildMarkdownCard(markdown);
  await client.im.message.patch({
    path: { message_id: msgId },
    data: { msg_type: "interactive", content: JSON.stringify(card) },
  });
}

// 工具调用卡片（可折叠内容）
export async function sendToolCard(
  client: lark.Client,
  chatId: string,
  label: string,
  detail: string,
  status: "running" | "done" | "error" = "running",
  resultPreview?: string
): Promise<string> {
  const statusIcon = status === "running" ? "⏳" : status === "done" ? "✅" : "❌";
  let content = `${label}\n\`${detail}\`\n${statusIcon} ${status === "running" ? "进行中..." : "完成"}`;

  if (resultPreview) {
    content += `\n\n<details>\n<summary>查看结果</summary>\n\n${resultPreview}\n\n</details>`;
  }

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

export async function updateToolCard(
  client: lark.Client,
  msgId: string,
  label: string,
  detail: string,
  resultPreview: string
): Promise<void> {
  let content = `${label}\n\`${detail}\`\n✅ 完成`;
  if (resultPreview) {
    content += `\n\n<details>\n<summary>查看结果</summary>\n\n\`\`\`\n${resultPreview}\n\`\`\`\n\n</details>`;
  }
  const card = buildMarkdownCard(content);
  await client.im.message.patch({
    path: { message_id: msgId },
    data: { msg_type: "interactive", content: JSON.stringify(card) },
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
