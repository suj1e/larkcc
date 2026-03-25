import * as lark from "@larksuiteoapi/node-sdk";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { OverflowConfig } from "./config.js";
import { sanitizeContent, formatWarnings, BlockType, LanguageMap, markdownToBlocks, DocumentMeta } from "./format/index.js";

// ── 文档注册表（本地追踪创建的文档，每个 profile 独立文件）─────────────────────────────

interface DocumentRecord {
  id: string;           // 文档 ID
  createdAt: number;    // 创建时间戳
}

const DOC_REGISTRY_DIR = path.join(os.homedir(), ".larkcc");

function getDocRegistryPath(profile: string): string {
  if (!profile || profile === "default") {
    return path.join(DOC_REGISTRY_DIR, "doc-registry.json");
  }
  return path.join(DOC_REGISTRY_DIR, `doc-registry-${profile}.json`);
}

function loadDocRegistry(profile: string): DocumentRecord[] {
  try {
    const filePath = getDocRegistryPath(profile);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch {
    // 忽略错误
  }
  return [];
}

function saveDocRegistry(profile: string, records: DocumentRecord[]): void {
  if (!fs.existsSync(DOC_REGISTRY_DIR)) {
    fs.mkdirSync(DOC_REGISTRY_DIR, { recursive: true });
  }
  const filePath = getDocRegistryPath(profile);
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf8");
}

function registerDocument(docId: string, profile: string): void {
  const records = loadDocRegistry(profile);
  records.push({
    id: docId,
    createdAt: Date.now(),
  });
  saveDocRegistry(profile, records);
}

function getOldestDocuments(profile: string, keepCount: number): DocumentRecord[] {
  const records = loadDocRegistry(profile);
  // 按创建时间升序排列（最旧的在前）
  const sortedDocs = [...records].sort((a, b) => a.createdAt - b.createdAt);
  // 返回需要删除的文档（超出保留数量的）
  if (sortedDocs.length <= keepCount) {
    return [];
  }
  return sortedDocs.slice(0, sortedDocs.length - keepCount);
}

function removeDocumentRecord(docId: string, profile: string): void {
  const records = loadDocRegistry(profile);
  const filtered = records.filter(r => r.id !== docId);
  saveDocRegistry(profile, filtered);
}

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
  // 过滤 blob URL 和外部图片
  const { content: sanitizedContent, warnings } = sanitizeContent(content);

  // 追加警告消息
  let finalContent = sanitizedContent;
  if (warnings.length > 0) {
    finalContent += formatWarnings(warnings);
  }

  try {
    const card = buildMarkdownCard(finalContent);
    await (client.im.message as any).reply({
      path: { message_id: rootMsgId },
      data: { content: JSON.stringify(card), msg_type: "interactive", reply_in_thread: false },
    });
  } catch {
    // 卡片失败 fallback 到普通文本
    await (client.im.message as any).reply({
      path: { message_id: rootMsgId },
      data: { content: JSON.stringify({ text: finalContent }), msg_type: "text", reply_in_thread: false },
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

    // 获取用户原始消息内容
    let originalMessage = "";
    try {
      const msgRes = await client.im.message.get({
        path: { message_id: rootMsgId },
      });
      const msgData = msgRes.data as any;
      // 提取消息文本内容
      if (msgData?.items?.[0]?.body?.content) {
        const content = JSON.parse(msgData.items[0].body.content);
        originalMessage = content.text || "";
      }
    } catch {
      // 获取失败时忽略
    }

    // 清理旧文档（如果启用）
    let cleanupResult: { deleted: number; failed: number } | null = null;
    const cleanupConfig = context.overflow.document.cleanup;
    if (cleanupConfig?.enabled) {
      cleanupResult = await cleanupOldDocuments(token, cleanupConfig.max_docs, context.profile);
    }

    // 构建文档元信息
    const meta: DocumentMeta = {
      cwd: context.cwd,
      profile: context.profile,
      sessionId: context.sessionId ?? "",
      datetime: datetime,
    };

    // 创建文档（在应用云空间）
    const { docUrl, docId } = await createOverflowDocument(token, title, markdown, originalMessage, meta);

    // 注册新文档到本地记录
    registerDocument(docId, context.profile);

    // 构建回复消息
    let replyMsg = `📝 内容较长，已写入云文档：${docUrl}`;
    if (cleanupConfig?.notify && cleanupResult && (cleanupResult.deleted > 0 || cleanupResult.failed > 0)) {
      if (cleanupResult.failed > 0) {
        replyMsg += `\n🗑️ 已清理 ${cleanupResult.deleted} 个旧文档，${cleanupResult.failed} 个删除失败`;
      } else {
        replyMsg += `\n🗑️ 已清理 ${cleanupResult.deleted} 个旧文档（保留最近 ${cleanupConfig.max_docs} 个）`;
      }
    }

    // 回复文档链接
    await sendMessageChunk(client, rootMsgId, replyMsg);
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
    console.error(`[IMAGE] Downloading image: ${imageKey}`);
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
    const sizeKB = Math.round(buf.length / 1024);
    console.error(`[IMAGE] Downloaded: ${mediaType}, ${sizeKB}KB, base64=${base64.length}chars`);
    return { base64, mediaType };
  } catch (e) {
    console.error(`[IMAGE] Download failed:`, e);
    return null;
  }
}

// ── 文件下载 ─────────────────────────────────────────────────

export interface DownloadedFile {
  filepath: string;      // 本地文件路径
  filename: string;      // 原始文件名
  size: number;          // 文件大小 (bytes)
  mime_type: string;     // MIME 类型
  file_key: string;      // 飞书文件 key
}

/**
 * 下载飞书消息中的文件到本地临时目录
 */
export async function downloadFile(
  client: lark.Client,
  messageId: string,
  fileKey: string,
  tempDir: string,
  filename: string,
): Promise<DownloadedFile | null> {
  try {
    console.error(`[FILE] Downloading file: ${fileKey}, name: ${filename}`);

    // 确保临时目录存在
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 下载文件
    const res = await client.im.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type: "file" },
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

    // 生成安全的文件名（添加时间戳避免冲突）
    const timestamp = Date.now();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueName = `${timestamp}_${safeName}`;
    const filepath = path.join(tempDir, uniqueName);

    // 写入文件
    fs.writeFileSync(filepath, buf);

    // 检测 MIME 类型
    const mimeTypes: Record<string, string> = {
      // 文档
      "pdf": "application/pdf",
      "doc": "application/msword",
      "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "xls": "application/vnd.ms-excel",
      "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "ppt": "application/vnd.ms-powerpoint",
      "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      // 文本
      "txt": "text/plain",
      "md": "text/markdown",
      "csv": "text/csv",
      "json": "application/json",
      "xml": "application/xml",
      "yaml": "application/x-yaml",
      "yml": "application/x-yaml",
      // 代码
      "js": "application/javascript",
      "ts": "application/typescript",
      "py": "text/x-python",
      "java": "text/x-java",
      "go": "text/x-go",
      "rs": "text/x-rust",
      "c": "text/x-c",
      "cpp": "text/x-c++",
      "h": "text/x-c",
      "hpp": "text/x-c++",
      "sh": "application/x-sh",
      "bash": "application/x-sh",
      // 压缩
      "zip": "application/zip",
      "tar": "application/x-tar",
      "gz": "application/gzip",
      "rar": "application/vnd.rar",
      "7z": "application/x-7z-compressed",
      // 其他
      "html": "text/html",
      "css": "text/css",
    };

    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const mime_type = mimeTypes[ext] || "application/octet-stream";

    const sizeKB = Math.round(buf.length / 1024);
    console.error(`[FILE] Downloaded: ${mime_type}, ${sizeKB}KB, saved to ${filepath}`);

    return {
      filepath,
      filename,
      size: buf.length,
      mime_type,
      file_key: fileKey,
    };
  } catch (e) {
    console.error(`[FILE] Download failed:`, e);
    return null;
  }
}

// ── 卡片构建 ─────────────────────────────────────────────────

function buildMarkdownCard(markdown: string, warnings: string[] = []) {
  let content = markdown;
  if (warnings.length > 0) {
    content += formatWarnings(warnings);
  }
  return {
    schema: "2.0",
    body: { elements: [{ tag: "markdown", content }] },
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
 * 创建云文档并写入内容（在应用云空间）
 */
export async function createOverflowDocument(
  token: string,
  title: string,
  markdown: string,
  originalMessage: string,
  meta: DocumentMeta
): Promise<{ docUrl: string; docId: string }> {
  // 1. 将 markdown 转换为文档块（同时过滤 blob URL）
  const { blocks } = markdownToBlocks(markdown, originalMessage, meta);

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
    // 第一批用 index: 0 插入开头，后续用 index: -1 追加到末尾
    const index = i === 0 ? 0 : -1;
    const updateRes = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks/${docId}/children`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        children: batch,
        index,
      }),
    });

    const updateData = await safeJsonParse(updateRes, "Write content") as { code?: number; msg?: string };
    if (updateData.code !== 0) {
      throw new Error(`Write content failed (${updateData.code}): ${updateData.msg}`);
    }
  }

  // 返回文档链接和 ID
  return {
    docUrl: `https://feishu.cn/docx/${docId}`,
    docId,
  };
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

/**
 * 清理旧文档
 * 使用本地注册表追踪文档，按创建时间排序，删除超出数量的旧文档
 * 注意：docx API 没有 DELETE 接口，需要使用 drive API 删除
 */
async function cleanupOldDocuments(
  token: string,
  maxDocs: number,
  profile: string
): Promise<{ deleted: number; failed: number }> {
  const result = { deleted: 0, failed: 0 };

  try {
    // 获取需要删除的文档（最旧的）
    const toDelete = getOldestDocuments(profile, maxDocs);

    for (const doc of toDelete) {
      try {
        // 使用 drive API 删除文档（docx 文档也是 drive 中的一种文件）
        const deleteRes = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${doc.id}?type=file`, {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${token}`,
          },
        });
        const deleteData = await safeJsonParse(deleteRes, "Delete document") as { code?: number };

        if (deleteData.code === 0) {
          result.deleted++;
          // 从注册表中移除
          removeDocumentRecord(doc.id, profile);
        } else {
          result.failed++;
          console.error(`Failed to delete document ${doc.id}:`, deleteData);
          // 即使删除失败也尝试从注册表移除（可能是文档已被手动删除）
          removeDocumentRecord(doc.id, profile);
        }
      } catch {
        result.failed++;
        // 从注册表移除无效记录
        removeDocumentRecord(doc.id, profile);
      }
    }
  } catch (error) {
    console.error("Cleanup error:", error);
  }

  return result;
}