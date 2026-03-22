import * as lark from "@larksuiteoapi/node-sdk";
import { OverflowConfig } from "./config.js";

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

export async function replyText(
  client: lark.Client,
  chatId: string,
  rootMsgId: string,
  text: string
): Promise<string> {
  const card = buildMarkdownCard(text);
  const res = await (client.im.message as any).reply({
    path: { message_id: rootMsgId },
    data: { content: JSON.stringify(card), msg_type: "interactive", reply_in_thread: false },
  });
  return res.data?.message_id ?? "";
}

export async function updateText(
  client: lark.Client,
  msgId: string,
  text: string
): Promise<void> {
  const card = buildMarkdownCard(text);
  await client.im.message.patch({
    path: { message_id: msgId },
    data: { content: JSON.stringify(card) },
  });
}

// 最终回复卡片，超长分段发送，卡片失败 fallback 到普通文本
const CHUNK_SIZE = 2800;

function splitMarkdown(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= size) {
      chunks.push(remaining);
      break;
    }
    // 尝试在换行处分割
    let cut = remaining.lastIndexOf("\n", size);
    if (cut < size * 0.5) cut = remaining.lastIndexOf(" ", size);
    if (cut < size * 0.5) cut = size;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  return chunks;
}

export async function replyFinalCard(
  client: lark.Client,
  chatId: string,
  rootMsgId: string,
  markdown: string,
  context?: ReplyContext
): Promise<void> {
  const threshold = context?.overflow.mode === "document"
    ? context.overflow.document.threshold
    : context?.overflow.chunk.threshold ?? CHUNK_SIZE;

  // 不超限，直接发送
  if (markdown.length <= threshold) {
    await sendMessageChunk(client, rootMsgId, markdown);
    return;
  }

  // 超限处理
  if (context?.overflow.mode === "document") {
    // 写入云文档
    await replyWithDocument(client, chatId, rootMsgId, markdown, context);
  } else {
    // 分片发送
    const chunks = splitMarkdown(markdown, context?.overflow.chunk.threshold ?? CHUNK_SIZE);
    for (let i = 0; i < chunks.length; i++) {
      const content = chunks.length > 1
        ? `**(${i + 1}/${chunks.length})**\n${chunks[i]}`
        : chunks[i];
      await sendMessageChunk(client, rootMsgId, content);
    }
  }
}

async function sendMessageChunk(
  client: lark.Client,
  rootMsgId: string,
  content: string
): Promise<void> {
  try {
    const card = buildMarkdownCard(content);
    await (client.im.message as any).reply({
      path: { message_id: rootMsgId },
      data: { content: JSON.stringify(card), msg_type: "interactive", reply_in_thread: false },
    });
  } catch {
    // 卡片失败 fallback 到普通文本
    await (client.im.message as any).reply({
      path: { message_id: rootMsgId },
      data: { content: JSON.stringify({ text: content }), msg_type: "text", reply_in_thread: false },
    });
  }
}

async function replyWithDocument(
  client: lark.Client,
  chatId: string,
  rootMsgId: string,
  markdown: string,
  context: ReplyContext
): Promise<void> {
  try {
    // 获取 tenant_access_token
    const token = await getTenantAccessToken(context.appId, context.appSecret);

    // 构建文档标题
    const now = new Date();
    const datetime = now.toISOString().replace("T", " ").slice(0, 19);
    const title = context.overflow.document.title_template
      .replace("{profile}", context.profile)
      .replace("{cwd}", context.cwd)
      .replace("{session_id}", context.sessionId ?? "")
      .replace("{datetime}", datetime)
      .replace("{date}", datetime.slice(0, 10));

    // 构建消息链接
    const messageLink = buildMessageLink(chatId, rootMsgId);

    // 创建文档（在应用云空间）
    const docUrl = await createOverflowDocument(token, title, markdown, messageLink);

    // 回复文档链接
    await sendMessageChunk(client, rootMsgId, `📝 内容较长，已写入云文档：${docUrl}`);
  } catch (error) {
    // 写文档失败，回退到分片发送
    console.error("Failed to create document:", error);
    await sendMessageChunk(client, rootMsgId, `❌ 写入云文档失败：${error}，回退到分片发送`);
    const chunks = splitMarkdown(markdown, CHUNK_SIZE);
    for (let i = 0; i < chunks.length; i++) {
      const content = `**(${i + 1}/${chunks.length})**\n${chunks[i]}`;
      await sendMessageChunk(client, rootMsgId, content);
    }
  }
}

export async function sendToolCard(
  client: lark.Client,
  chatId: string,
  rootMsgId: string,
  label: string,
  detail: string,
  status: "running" | "done" | "error" = "running",
): Promise<string> {
  const statusIcon = status === "running" ? "⏳ 进行中..." : status === "done" ? "✅ 完成" : "❌ 失败";
  const content = `${label}\n\`${detail}\`\n${statusIcon}`;
  const card = buildMarkdownCard(content);
  const res = await (client.im.message as any).reply({
    path: { message_id: rootMsgId },
    data: { content: JSON.stringify(card), msg_type: "interactive", reply_in_thread: false },
  });
  return res.data?.message_id ?? "";
}

export async function updateToolCard(
  client: lark.Client,
  msgId: string,
  label: string,
  detail: string,
  _resultPreview: string
): Promise<void> {
  const content = `${label}\n\`${detail}\`\n✅ 完成`;
  const card = buildMarkdownCard(content);
  await client.im.message.patch({
    path: { message_id: msgId },
    data: { content: JSON.stringify(card) },
  });
}

// ── 图片下载 ─────────────────────────────────────────────────

export async function downloadImage(
  client: lark.Client,
  messageId: string,
  imageKey: string,
): Promise<{ base64: string; mediaType: string } | null> {
  try {
    const res = await client.im.messageResource.get({
      path: { message_id: messageId, file_key: imageKey },
      params: { type: "image" },
    });
    const stream = (res as any).getReadableStream();
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: any) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    const buf = Buffer.concat(chunks);
    const base64 = buf.toString("base64");
    const header = buf.slice(0, 4).toString("hex");
    let mediaType = "image/jpeg";
    if (header.startsWith("89504e47")) mediaType = "image/png";
    else if (header.startsWith("47494638")) mediaType = "image/gif";
    else if (header.startsWith("52494646")) mediaType = "image/webp";
    return { base64, mediaType };
  } catch {
    return null;
  }
}

// ── 卡片构建 ─────────────────────────────────────────────────

function buildMarkdownCard(markdown: string) {
  return {
    schema: "2.0",
    body: { elements: [{ tag: "markdown", content: markdown }] },
  };
}

// ── 云文档（超长消息写入）─────────────────────────────────────

interface ReplyContext {
  profile: string;
  cwd: string;
  sessionId: string;
  overflow: OverflowConfig;
  chatId: string;
  rootMsgId: string;
  appId: string;
  appSecret: string;
}

/**
 * 安全解析 JSON 响应
 */
async function safeJsonParse(res: Response, context: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${context} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${context} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * 将 Markdown 文本转换为飞书文档块
 * 支持标题和文本，保留 markdown 格式
 */
function markdownToBlocks(markdown: string, messageLink: string): any[] {
  const blocks: any[] = [];
  const header = `📎 查看原消息：${messageLink}\n\n---`;

  // 添加头部
  blocks.push({
    block_type: 2,
    text: { elements: [{ text_run: { content: header } }] },
  });

  // 处理 markdown 内容
  const lines = markdown.split("\n");
  let currentPara: string[] = [];

  for (const line of lines) {
    // 标题处理
    if (line.startsWith("### ")) {
      if (currentPara.length > 0) {
        blocks.push({
          block_type: 2,
          text: { elements: [{ text_run: { content: currentPara.join("\n") } }] },
        });
        currentPara = [];
      }
      blocks.push({
        block_type: 3,
        heading3: { elements: [{ text_run: { content: line.slice(4) } }] },
      });
    } else if (line.startsWith("## ")) {
      if (currentPara.length > 0) {
        blocks.push({
          block_type: 2,
          text: { elements: [{ text_run: { content: currentPara.join("\n") } }] },
        });
        currentPara = [];
      }
      blocks.push({
        block_type: 3,
        heading2: { elements: [{ text_run: { content: line.slice(3) } }] },
      });
    } else if (line.startsWith("# ")) {
      if (currentPara.length > 0) {
        blocks.push({
          block_type: 2,
          text: { elements: [{ text_run: { content: currentPara.join("\n") } }] },
        });
        currentPara = [];
      }
      blocks.push({
        block_type: 3,
        heading1: { elements: [{ text_run: { content: line.slice(2) } }] },
      });
    } else {
      currentPara.push(line);
    }
  }

  // 添加最后一个段落
  if (currentPara.length > 0) {
    blocks.push({
      block_type: 2,
      text: { elements: [{ text_run: { content: currentPara.join("\n") } }] },
    });
  }

  return blocks;
}

/**
 * 创建云文档并写入内容（在应用云空间）
 */
export async function createOverflowDocument(
  token: string,
  title: string,
  markdown: string,
  messageLink: string
): Promise<string> {
  // 1. 将 markdown 转换为文档块
  const blocks = markdownToBlocks(markdown, messageLink);

  // 2. 创建文档（不指定 folder_token，创建在应用云空间）
  const createRes = await fetch("https://open.feishu.cn/open-apis/docx/v1/documents", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title }),
  });
  const createData = await safeJsonParse(createRes, "Create document") as { data?: { document?: { document_id?: string } } };
  const docId = createData.data?.document?.document_id;

  if (!docId) {
    throw new Error("Failed to create document");
  }

  // 3. 写入内容到文档（分批写入，每批最多 50 个块）
  const BATCH_SIZE = 50;
  for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
    const batch = blocks.slice(i, i + BATCH_SIZE);
    const updateRes = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks/${docId}/children`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        children: batch,
        index: 0,
      }),
    });

    const updateData = await safeJsonParse(updateRes, "Write content") as { code?: number; msg?: string };
    if (updateData.code !== 0) {
      throw new Error(`Failed to write content: ${updateData.msg}`);
    }
  }

  // 返回文档链接
  return `https://feishu.cn/docx/${docId}`;
}

/**
 * 获取 tenant_access_token
 * 直接使用 appId 和 appSecret 获取
 */
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  // 检查缓存
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  });
  const data = await safeJsonParse(res, "Get access token") as { tenant_access_token?: string; expire?: number; code?: number; msg?: string };
  if (!data.tenant_access_token) {
    throw new Error(`Failed to get tenant access token: ${data.msg ?? JSON.stringify(data)}`);
  }
  // 缓存 token（提前 5 分钟过期）
  cachedToken = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + ((data.expire ?? 7200) - 300) * 1000,
  };
  return cachedToken.token;
}

/**
 * 构建飞书消息链接
 */
function buildMessageLink(chatId: string, messageId: string): string {
  return `https://feishu.cn/client/chat/open?openChatId=${chatId}&openMessageId=${messageId}`;
}