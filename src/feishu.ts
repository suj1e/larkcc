import * as lark from "@larksuiteoapi/node-sdk";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { OverflowConfig, CardTableConfig } from "./config.js";
import { sanitizeContent, formatWarnings, markdownToBlocks, DocumentMeta, countTables, optimizeForCard, BlockType } from "./format/index.js";
import { buildThinkingPanel } from "./format/duration.js";
import type { Block, DocumentBlockItem, CalloutDescendants, TableDescendants } from "./format/index.js";

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

export function registerDocument(docId: string, profile: string): void {
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
const DEFAULT_MAX_TABLES_PER_CARD = 5;

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

/**
 * 按表格数量拆分 Markdown
 * 标题跟随其后的表格，保证表格不跨段
 */
function splitMarkdownByTables(markdown: string, maxTables: number): string[] {
  const lines = markdown.split('\n');
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let tableCount = 0;
  let inTable = false;
  let pendingHeading: string | null = null;

  const isTableRow = (line: string): boolean => {
    const trimmed = line.trim();
    return trimmed.startsWith('|') && trimmed.endsWith('|');
  };

  const isTableSeparator = (line: string): boolean => {
    return /^\|[\s\-:|]+\|$/.test(line.trim());
  };

  const flushChunk = () => {
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
      currentChunk = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 检测标题（可能紧跟表格）
    if (/^#{1,6}\s/.test(trimmed)) {
      // 如果当前 chunk 已经满了，且不在表格中，先 flush
      if (tableCount >= maxTables && !inTable) {
        flushChunk();
        tableCount = 0;
      }
      pendingHeading = line;
      continue;
    }

    // 检测表格开始
    if (isTableRow(trimmed) && !inTable) {
      // 检查下一行是否是分隔符（确认是表格）
      if (i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        // 如果当前 chunk 已满，先 flush
        if (tableCount >= maxTables) {
          flushChunk();
          tableCount = 0;
        }
        // 添加待处理的标题
        if (pendingHeading) {
          currentChunk.push(pendingHeading);
          pendingHeading = null;
        }
        inTable = true;
        tableCount++;
      }
    }

    // 添加待处理的标题（如果不是表格前的标题）
    if (pendingHeading && !isTableRow(trimmed)) {
      currentChunk.push(pendingHeading);
      pendingHeading = null;
    }

    currentChunk.push(line);

    // 检测表格结束
    if (inTable && !isTableRow(trimmed) && !isTableSeparator(trimmed)) {
      inTable = false;
    }
  }

  // 处理剩余内容
  if (pendingHeading) {
    currentChunk.push(pendingHeading);
  }
  flushChunk();

  return chunks;
}

export interface ReplyFinalOptions {
  /** 底部元数据（耗时、token 等），仅追加到卡片 */
  metadata?: string;
  /** 思考内容，显示在可折叠区域 */
  thinking?: string;
  /** 卡片标题 */
  cardTitle?: string;
}

export async function replyFinalCard(
  client: lark.Client,
  chatId: string,
  rootMsgId: string,
  markdown: string,
  context?: ReplyContext,
  options?: ReplyFinalOptions,
): Promise<void> {
  const threshold = context?.overflow.mode === "document"
    ? context.overflow.document.threshold
    : context?.overflow.chunk.threshold ?? CHUNK_SIZE;

  const tableCount = countTables(markdown);
  const maxTablesPerCard = context?.card_table?.max_tables_per_card ?? DEFAULT_MAX_TABLES_PER_CARD;

  // 表格数量超过卡片承载能力
  if (tableCount > maxTablesPerCard) {
    if (context?.overflow.mode === "document" && markdown.length > threshold) {
      // 表格多 + 内容长 → 文档（文档比分片更适合承载大量表格+长文本）
      await replyWithDocument(client, chatId, rootMsgId, markdown, context);
    } else {
      // 表格多 + 内容短 → 按表格拆分为多个卡片
      const chunks = splitMarkdownByTables(markdown, maxTablesPerCard);
      for (const chunk of chunks) {
        await sendMessageChunk(client, rootMsgId, chunk);
      }
    }
    return;
  }

  // 不超限，直接发送
  if (markdown.length <= threshold) {
    const finalContent = options?.metadata
      ? `${markdown}\n\n---\n${options.metadata}`
      : markdown;
    await sendMessageChunk(client, rootMsgId, finalContent, options?.thinking, options?.cardTitle);
    return;
  }

  // 超限处理
  if (context?.overflow.mode === "document") {
    // 文档模式：不追加 metadata 和 thinking
    await replyWithDocument(client, chatId, rootMsgId, markdown, context);
  } else {
    const chunks = splitMarkdown(markdown, context?.overflow.chunk.threshold ?? CHUNK_SIZE);
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const content = chunks.length > 1
        ? `**(${i + 1}/${chunks.length})**\n${chunks[i]}`
        : chunks[i];
      // 仅在最后一个 chunk 追加 metadata 和 thinking
      const finalContent = isLast && options?.metadata
        ? `${content}\n\n---\n${options.metadata}`
        : content;
      await sendMessageChunk(client, rootMsgId, finalContent, isLast ? options?.thinking : undefined, isLast ? options?.cardTitle : undefined);
    }
  }
}

async function sendMessageChunk(
  client: lark.Client,
  rootMsgId: string,
  content: string,
  thinking?: string,
  cardTitle?: string,
): Promise<void> {
  // 过滤 blob URL 和外部图片
  const { content: sanitizedContent, warnings } = sanitizeContent(content);

  // 追加警告消息
  let finalContent = sanitizedContent;
  if (warnings.length > 0) {
    finalContent += formatWarnings(warnings);
  }

  try {
    const optimizedContent = optimizeForCard(finalContent);
    const card = buildMarkdownCard(optimizedContent, [], { thinking, cardTitle });
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

/**
 * 准备溢出文档所需的上下文（标题、原始消息、元信息）
 */
export async function prepareOverflowContext(
  client: lark.Client,
  rootMsgId: string,
  context: ReplyContext,
): Promise<{ token: string; title: string; originalMessage: string; meta: DocumentMeta }> {
  // 仅当缓存 token 剩余不足 10 分钟时才刷新，避免不必要的 HTTP 调用
  if (cachedToken && cachedToken.expiresAt - Date.now() < 600_000) {
    cachedToken = null;
  }
  const token = await getTenantAccessToken(context.appId, context.appSecret);

  const now = new Date();
  const datetime = now.toISOString().replace("T", " ").slice(0, 19);
  const title = context.overflow.document.title_template
    .replace("{profile}", context.profile)
    .replace("{cwd}", context.cwd)
    .replace("{session_id}", context.sessionId ?? "")
    .replace("{datetime}", datetime)
    .replace("{date}", datetime.slice(0, 10));

  let originalMessage = "";
  try {
    const msgRes = await client.im.message.get({
      path: { message_id: rootMsgId },
    });
    const msgData = msgRes.data as any;
    if (msgData?.items?.[0]?.body?.content) {
      const content = JSON.parse(msgData.items[0].body.content);
      originalMessage = content.text || "";
    }
  } catch { /* ignore */ }

  const meta: DocumentMeta = {
    cwd: context.cwd,
    profile: context.profile,
    sessionId: context.sessionId ?? "",
    datetime,
  };

  return { token, title, originalMessage, meta };
}

async function replyWithDocument(
  client: lark.Client,
  chatId: string,
  rootMsgId: string,
  markdown: string,
  context: ReplyContext
): Promise<void> {
  try {
    const { token, title, originalMessage, meta } = await prepareOverflowContext(client, rootMsgId, context);

    // 清理旧文档（如果启用）
    let cleanupResult: { deleted: number; failed: number } | null = null;
    const cleanupConfig = context.overflow.document.cleanup;
    if (cleanupConfig?.enabled) {
      cleanupResult = await cleanupOldDocuments(token, cleanupConfig.max_docs, context.profile);
    }

    // 创建文档（在应用云空间）
    const { docUrl, docId, warnings: docWarnings } = await createOverflowDocument(token, title, markdown, originalMessage, meta);

    // 注册新文档到本地记录
    registerDocument(docId, context.profile);

    // 构建回复消息
    let replyMsg = `📝 内容较长，已写入云文档：${docUrl}`;
    if (docWarnings.length > 0) {
      replyMsg += `\n⚠️ ${docWarnings.join("；")}`;
    }
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

// 按工具名匹配的状态词
const TOOL_STATUS_WORDS: Record<string, string[]> = {
  Read:  ["📖 Reading...", "📖 Scanning..."],
  Write: ["📝 Writing...", "📝 Creating..."],
  Edit:  ["✏️ Editing...", "✏️ Modifying..."],
  Bash:  ["⚡ Running...", "⚡ Executing..."],
  Glob:  ["📂 Finding files...", "📂 Scanning..."],
  Grep:  ["🔍 Searching...", "🔍 Analyzing..."],
  LS:    ["📁 Listing...", "📁 Browsing..."],
};

export async function sendToolCard(
  client: lark.Client,
  chatId: string,
  rootMsgId: string,
  label: string,
  detail: string,
  status: "running" | "done" | "error" = "running",
  toolName?: string,
): Promise<string> {
  const DEFAULT_STATUS = {
    running: "⏳ Processing...",
    done: "✅ 完成",
    error: "❌ 失败",
  } as const;

  let statusIcon: string = DEFAULT_STATUS[status];
  if (status === "running" && toolName) {
    const words = TOOL_STATUS_WORDS[toolName];
    if (words?.length) {
      statusIcon = words[Math.floor(Math.random() * words.length)];
    }
  }

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

export interface CardBuildOptions {
  /** 思考内容（完整），显示在可折叠区域 */
  thinking?: string;
  /** 思考进行中指示器（流式中间态） */
  thinkingInProgress?: boolean;
  /** 思考耗时（毫秒） */
  reasoningElapsedMs?: number;
  /** 卡片标题，为空则不显示 header */
  cardTitle?: string;
}

/**
 * 构建飞书卡片 JSON
 *
 * 支持可选的思考过程折叠区域：
 * - thinkingInProgress: 流式中间态，显示"💭 思考中..."提示
 * - thinking: 完成态，显示可折叠的思考过程
 */
export function buildMarkdownCard(markdown: string, warnings: string[] = [], options?: CardBuildOptions) {
  let content = markdown;
  if (warnings.length > 0) {
    content += formatWarnings(warnings);
  }

  const elements: any[] = [];

  // 思考过程区域
  if (options?.thinkingInProgress) {
    elements.push({ tag: "markdown", content: "💭 思考中..." });
  } else if (options?.thinking) {
    elements.push(...buildThinkingPanel({
      thinking: options.thinking,
      reasoningElapsedMs: options.reasoningElapsedMs,
    }));
  }

  elements.push({ tag: "markdown", content });

  const card: any = {
    schema: "2.0",
    config: { wide_screen_mode: true },
    body: { elements },
  };

  if (options?.cardTitle) {
    card.header = {
      title: { tag: "plain_text", content: options.cardTitle },
      template: "blue",
    };
  }

  return card;
}

// ── 云文档（超长消息写入）─────────────────────────────────────

export interface ReplyContext {
  profile: string;
  cwd: string;
  sessionId: string;
  overflow: OverflowConfig;
  chatId: string;
  rootMsgId: string;
  appId: string;
  appSecret: string;
  card_table?: CardTableConfig;
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
 *
 * 写入流程（严格保序）：
 * - 简单块：分批通过 children API 写入
 * - 表格/高亮块：通过 descendants API 写入
 * - 保持原始文档顺序
 */
export async function createOverflowDocument(
  token: string,
  title: string,
  markdown: string,
  originalMessage: string,
  meta: DocumentMeta
): Promise<{ docUrl: string; docId: string; warnings: string[] }> {
  // 1. 将 markdown 转换为文档块
  const { items } = markdownToBlocks(markdown, originalMessage, meta);

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

  // 3. 严格保序写入（带容错）
  const BATCH_SIZE = 50;
  let simpleBatch: Block[] = [];
  let isFirstBatch = true;
  let batchIndex = 0;
  const writeWarnings: string[] = [];

  const flushSimpleBatch = async () => {
    if (simpleBatch.length === 0) return;
    batchIndex++;
    const index = isFirstBatch ? 0 : -1;
    const batchTypes = simpleBatch.map(b => b.block_type);

    try {
      await batchCreateBlocks(token, docId, simpleBatch, index);
      isFirstBatch = false;
    } catch (error) {
      const errMsg = `Batch ${batchIndex} 写入失败（${simpleBatch.length} 个块），已跳过`;
      console.error(`[DOC] ${errMsg}:`, error);
      console.error(`[DOC] Block types: [${batchTypes.join(", ")}]`);
      writeWarnings.push(errMsg);
      // 不抛出，继续后续处理
    } finally {
      simpleBatch = [];
    }
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    switch (item.type) {
      case "simple":
        simpleBatch.push(item.block);
        if (simpleBatch.length >= BATCH_SIZE) {
          await flushSimpleBatch();
        }
        break;

      case "table":
        await flushSimpleBatch();
        try {
          await createTableDescendants(token, docId, item.data);
        } catch (error) {
          console.error(`[DOC] Table descendants failed at item ${i}:`, error);
          // 降级为代码块：包含原始 Markdown 保留可读性
          const tableInfo = item.data.tableBlock.table.property;
          const rawMd = item.data.rawMarkdown ?? "";
          writeWarnings.push(`表格渲染失败（${tableInfo.row_size}行 × ${tableInfo.column_size}列）`);
          const fallbackContent = rawMd
            ? `⚠️ 表格渲染失败（${tableInfo.row_size}行 × ${tableInfo.column_size}列），原始内容：\n${rawMd}`
            : `⚠️ 表格渲染失败（${tableInfo.row_size}行 × ${tableInfo.column_size}列）`;
          simpleBatch.push({
            block_type: BlockType.CODE,
            code: {
              style: { language: 1, wrap: true },
              elements: [{
                text_run: { content: fallbackContent },
              }],
            },
          });
        }
        break;

      case "callout":
        await flushSimpleBatch();
        try {
          await createCalloutDescendants(token, docId, item.data);
        } catch (error) {
          console.error(`[DOC] Callout descendants failed at item ${i}:`, error);
          writeWarnings.push("高亮块渲染失败");
          // 降级为普通引用块
          const calloutTexts = item.data.contentDescendants
            .map(d => d.text?.elements?.map(e => e.text_run?.content ?? "").join("") ?? "")
            .filter(Boolean);
          simpleBatch.push({
            block_type: BlockType.QUOTE,
            quote: { elements: [{ text_run: { content: calloutTexts.join("\n") } }] },
          });
        }
        break;
    }
  }

  // 写入剩余的简单块
  await flushSimpleBatch();

  // 返回文档链接和 ID
  return {
    docUrl: `https://feishu.cn/docx/${docId}`,
    docId,
    warnings: writeWarnings,
  };
}

/**
 * 批量创建文档块（children API）
 */
async function batchCreateBlocks(
  token: string,
  docId: string,
  children: Block[],
  index: number
): Promise<void> {
  const url = `https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks/${docId}/children`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ children, index }),
  });

  const data = await safeJsonParse(res, "Batch create blocks") as {
    code?: number;
    msg?: string;
    data?: { children?: Array<{ block_id?: string; block_type?: number }> };
  };

  if (data.code !== 0) {
    console.error(`[DOC] API error response:`, JSON.stringify(data, null, 2));
    throw new Error(`Write content failed (${data.code}): ${data.msg}`);
  }
}

/**
 * 通过 Descendants API 创建表格
 * 一次性创建 table + table_cell + cell text blocks
 */
async function createTableDescendants(
  token: string,
  docId: string,
  table: TableDescendants
): Promise<void> {
  const url = `https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks/${docId}/descendants`;
  const body = {
    children_id: [docId],
    descendants: [
      table.tableBlock,
      ...table.cellDescendants,
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await safeJsonParse(res, "Create table descendants") as {
    code?: number;
    msg?: string;
  };

  if (data.code !== 0) {
    console.error(`[DOC] Table API error response:`, JSON.stringify(data, null, 2));
    console.error(`[DOC] Table payload (truncated):`, JSON.stringify(table.tableBlock, null, 2).slice(0, 500));
    throw new Error(`Create table failed (${data.code}): ${data.msg}`);
  }
}

/**
 * 通过 Descendants API 创建高亮块
 * 一次性创建 callout + content text blocks
 */
async function createCalloutDescendants(
  token: string,
  docId: string,
  callout: CalloutDescendants
): Promise<void> {
  const url = `https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks/${docId}/descendants`;
  const body = {
    children_id: [docId],
    descendants: [
      callout.calloutBlock,
      ...callout.contentDescendants,
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await safeJsonParse(res, "Create callout descendants") as {
    code?: number;
    msg?: string;
  };

  if (data.code !== 0) {
    console.error(`[DOC] Callout API error response:`, JSON.stringify(data, null, 2));
    console.error(`[DOC] Callout payload:`, JSON.stringify(callout.calloutBlock, null, 2).slice(0, 500));
    throw new Error(`Create callout failed (${data.code}): ${data.msg}`);
  }
}

/**
 * 获取 tenant_access_token
 * 直接使用 appId 和 appSecret 获取
 */
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * 使缓存的 token 失效，下次调用 getTenantAccessToken 时强制刷新
 */
export function invalidateTokenCache(): void {
  cachedToken = null;
}

export async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
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