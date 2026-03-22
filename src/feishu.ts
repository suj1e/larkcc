import * as lark from "@larksuiteoapi/node-sdk";
import { OverflowConfig, saveFolderToken } from "./config.js";

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
    // 检查 folder_token 是否配置
    const folderToken = context.overflow.document.folder_token;
    if (!folderToken) {
      await sendMessageChunk(client, rootMsgId, `❌ 未配置云文档文件夹 token，请在 config.yml 中设置 overflow.document.folder_token，回退到分片发送`);
      const chunks = splitMarkdown(markdown, CHUNK_SIZE);
      for (let i = 0; i < chunks.length; i++) {
        const content = `**(${i + 1}/${chunks.length})**\n${chunks[i]}`;
        await sendMessageChunk(client, rootMsgId, content);
      }
      return;
    }

    // 获取 token
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

    // 创建文档
    const docUrl = await createOverflowDocument(token, folderToken, title, markdown, messageLink);

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
 * 创建云文档并写入内容
 * 使用飞书 HTTP API
 */
export async function createOverflowDocument(
  token: string,
  folderToken: string,
  title: string,
  markdown: string,
  messageLink: string
): Promise<string> {
  // 1. 使用 convert API 将 markdown 转换为文档块
  const contentWithLink = `> 📎 [查看原消息](${messageLink})\n\n---\n\n${markdown}`;
  const convertRes = await fetch("https://open.feishu.cn/open-apis/docx/v1/documents/convert", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content_type: "markdown",
      content: contentWithLink,
    }),
  });
  const convertData = await convertRes.json() as { data?: { blocks?: any[] } };
  const blocks = convertData.data?.blocks ?? [];

  if (blocks.length === 0) {
    throw new Error("Failed to convert markdown to blocks");
  }

  // 2. 创建文档（使用 drive.file.createFolder 创建的是文件夹，需要用其他方式创建文档）
  // 实际上飞书没有直接创建 docx 的 API，需要通过 wiki 或其他方式
  // 这里简化：使用 wiki.space.node.create 创建文档
  const createRes = await fetch("https://open.feishu.cn/open-apis/wiki/v2/spaces/nodes/create", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      obj_type: "docx",
      node_type: "origin",
      title: title,
    }),
  });
  const createData = await createRes.json() as { data?: { node?: { obj_token?: string } } };
  const docToken = createData.data?.node?.obj_token;

  if (!docToken) {
    throw new Error("Failed to create document");
  }

  // 3. 写入内容到文档
  const updateRes = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${docToken}/blocks/${docToken}/children/batch_create`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      children: blocks.map(block => ({
        block_type: block.block_type,
        [getBlockTypeKey(block.block_type)]: block[getBlockTypeKey(block.block_type)],
      })),
      index: 0,
    }),
  });

  const updateData = await updateRes.json();
  if (updateData.code !== 0) {
    throw new Error(`Failed to write content: ${updateData.msg}`);
  }

  // 返回文档链接
  return `https://feishu.cn/docx/${docToken}`;
}

/**
 * 获取 block_type 对应的 key
 */
function getBlockTypeKey(blockType: number): string {
  const typeMap: Record<number, string> = {
    1: "page",
    2: "text",
    3: "heading",
    4: "code",
    5: "bullet_list",
    6: "ordered_list",
    7: "todo_list",
    8: "toggle",
    9: "divider",
    10: "image",
    11: "table",
    12: "quote",
    13: "callout",
  };
  return typeMap[blockType] ?? "text";
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
  const data = await res.json() as { tenant_access_token?: string; expire?: number };
  if (!data.tenant_access_token) {
    throw new Error("Failed to get tenant access token");
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