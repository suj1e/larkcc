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

// 飞书文档块类型常量（通过 API 测试验证）
// 注意：飞书 API 的 block_type 与文档类型是一一对应的，不是用属性区分
const BlockType = {
  PAGE: 1,       // 页面
  TEXT: 2,       // 文本
  HEADING1: 3,   // 一级标题
  HEADING2: 4,   // 二级标题
  HEADING3: 5,   // 三级标题
  BULLET: 12,    // 无序列表
  ORDERED: 13,   // 有序列表
  CODE: 14,      // 代码块
  QUOTE: 15,     // 引用块
  DIVIDER: 22,   // 分割线
} as const;

// 语言映射表（将常见语言名转换为飞书支持的语言编号）
// 飞书语言编码参考 SDK types 定义
const LanguageMap: Record<string, number> = {
  // 默认/纯文本
  "": 1,
  "text": 1,
  "plaintext": 1,
  // 常见语言
  "bash": 11,
  "sh": 11,
  "shell": 11,
  "zsh": 11,
  "c": 14,
  "cmake": 15,
  "csharp": 16,
  "cs": 16,
  "cpp": 17,
  "c++": 17,
  "cc": 17,
  "cxx": 17,
  "css": 21,
  "dart": 22,
  "dockerfile": 25,
  "docker": 25,
  "go": 34,
  "golang": 34,
  "groovy": 35,
  "gradle": 35,
  "html": 37,
  "java": 39,
  "javascript": 40,
  "js": 40,
  "jsx": 41,
  "javascriptreact": 41,
  "json": 42,
  "kotlin": 44,
  "kt": 44,
  "kts": 44,
  "latex": 45,
  "tex": 45,
  "less": 46,
  "lua": 48,
  "makefile": 49,
  "make": 49,
  "markdown": 50,
  "md": 50,
  "perl": 57,
  "pl": 57,
  "pm": 57,
  "php": 58,
  "powershell": 59,
  "ps1": 59,
  "pwsh": 59,
  "python": 62,
  "py": 62,
  "r": 63,
  "ruby": 64,
  "rb": 64,
  "rust": 65,
  "rs": 65,
  "scala": 68,
  "scss": 70,
  "sass": 67,
  "sql": 72,
  "swift": 73,
  "typescript": 74,
  "ts": 74,
  "tsx": 75,
  "typescriptreact": 75,
  "xml": 77,
  "yaml": 78,
  "yml": 78,
};

/**
 * 解析内联 Markdown 文本，支持粗体、斜体、行内代码、链接等
 * 返回飞书文本元素数组
 */
function parseInlineText(text: string): any[] {
  const elements: any[] = [];
  let remaining = text;

  // 正则表达式匹配各种内联元素（按优先级排序）
  while (remaining.length > 0) {
    // 链接 [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      elements.push({
        text_run: {
          content: linkMatch[1],
          text_element_style: { link: { url: linkMatch[2] } },
        },
      });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // 粗体 **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      elements.push({
        text_run: {
          content: boldMatch[1],
          text_element_style: { bold: true },
        },
      });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // 行内代码 `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      elements.push({
        text_run: {
          content: codeMatch[1],
          text_element_style: { inline_code: true },
        },
      });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // 斜体 *text* 或 _text_（避免与粗体混淆）
    const italicMatch = remaining.match(/^(?<!\*)\*([^*]+)\*(?!\*)|^(?<!_)_([^_]+)_(?!_)/);
    if (italicMatch) {
      const content = italicMatch[1] || italicMatch[2];
      elements.push({
        text_run: {
          content,
          text_element_style: { italic: true },
        },
      });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // 删除线 ~~text~~
    const strikeMatch = remaining.match(/^~~([^~]+)~~/);
    if (strikeMatch) {
      elements.push({
        text_run: {
          content: strikeMatch[1],
          text_element_style: { strikethrough: true },
        },
      });
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // 查找下一个特殊字符的位置
    const nextSpecial = remaining.search(/[*_`~\[]/);
    if (nextSpecial === -1) {
      // 没有更多特殊字符，添加剩余文本
      if (remaining) {
        elements.push({ text_run: { content: remaining } });
      }
      break;
    } else if (nextSpecial > 0) {
      // 添加特殊字符前的普通文本
      elements.push({ text_run: { content: remaining.slice(0, nextSpecial) } });
      remaining = remaining.slice(nextSpecial);
    } else {
      // 特殊字符在开头但无法匹配任何模式，作为普通字符处理
      elements.push({ text_run: { content: remaining[0] } });
      remaining = remaining.slice(1);
    }
  }

  return elements.length > 0 ? elements : [{ text_run: { content: "" } }];
}

/**
 * 将 Markdown 文本转换为飞书文档块
 * 支持标题、代码块、列表、引用和文本
 */
function markdownToBlocks(markdown: string, messageLink: string): any[] {
  const blocks: any[] = [];

  // 处理 markdown 内容
  const lines = markdown.split("\n");
  let currentPara: string[] = [];
  let inCodeBlock = false;
  let codeContent: string[] = [];
  let codeLang = "";

  const flushPara = () => {
    if (currentPara.length > 0) {
      const content = currentPara.join("\n").trim();
      if (content) {
        // 解析内联 Markdown 格式
        const elements = parseInlineText(content);
        blocks.push({
          block_type: BlockType.TEXT,
          text: { elements },
        });
      }
      currentPara = [];
    }
  };

  // 处理列表项
  const flushListItem = (item: string, isOrdered: boolean, _number?: number) => {
    const trimmed = item.trim();
    if (!trimmed) return;

    const blockType = isOrdered ? BlockType.ORDERED : BlockType.BULLET;
    const property = isOrdered ? "ordered" : "bullet";

    // 解析内联 Markdown 格式
    const elements = parseInlineText(trimmed);
    blocks.push({
      block_type: blockType,
      [property]: { elements },
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块处理
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        flushPara();
        inCodeBlock = true;
        codeLang = line.slice(3).trim().toLowerCase();
        codeContent = [];
      } else {
        // 代码块结束，创建原生代码块
        const code = codeContent.join("\n");
        const langId = LanguageMap[codeLang] ?? 1;

        blocks.push({
          block_type: BlockType.CODE,
          code: {
            style: { language: langId, wrap: true },
            elements: [{ text_run: { content: code } }],
          },
        });
        inCodeBlock = false;
        codeContent = [];
        codeLang = "";
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent.push(line);
      continue;
    }

    // 引用块处理 (> 开头)
    if (line.startsWith("> ")) {
      flushPara();
      const quoteContent = line.slice(2).trim();
      if (quoteContent) {
        const elements = parseInlineText(quoteContent);
        blocks.push({
          block_type: BlockType.QUOTE,
          quote: { elements },
        });
      }
      continue;
    }

    // 无序列表处理 (- 或 * 开头)
    const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushPara();
      flushListItem(bulletMatch[2], false);
      continue;
    }

    // 有序列表处理 (数字. 开头)
    const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      flushPara();
      flushListItem(orderedMatch[3], true, parseInt(orderedMatch[2]));
      continue;
    }

    // 标题处理（每种标题使用不同的 block_type）
    if (line.startsWith("### ")) {
      flushPara();
      const headingContent = line.slice(4);
      const elements = parseInlineText(headingContent);
      blocks.push({
        block_type: BlockType.HEADING3,
        heading3: { elements },
      });
    } else if (line.startsWith("## ")) {
      flushPara();
      const headingContent = line.slice(3);
      const elements = parseInlineText(headingContent);
      blocks.push({
        block_type: BlockType.HEADING2,
        heading2: { elements },
      });
    } else if (line.startsWith("# ")) {
      flushPara();
      const headingContent = line.slice(2);
      const elements = parseInlineText(headingContent);
      blocks.push({
        block_type: BlockType.HEADING1,
        heading1: { elements },
      });
    } else if (line.trim() === "---" || line.trim() === "***" || line.trim() === "___") {
      // 分割线
      flushPara();
      blocks.push({ block_type: BlockType.DIVIDER, divider: {} });
    } else {
      currentPara.push(line);
    }
  }

  // 处理未结束的代码块
  if (inCodeBlock && codeContent.length > 0) {
    const code = codeContent.join("\n");
    const langId = LanguageMap[codeLang] ?? 0;
    blocks.push({
      block_type: BlockType.CODE,
      code: {
        style: { language: langId, wrap: true },
        elements: [{ text_run: { content: code } }],
      },
    });
  }

  // 添加最后一个段落
  flushPara();

  // 在标题后面插入引用块（说明这是 AI 回复的完整内容）
  const quoteBlock = {
    block_type: BlockType.QUOTE,
    quote: {
      elements: [{ text_run: { content: `💬 此文档为 AI 回复的完整内容，因消息过长已转为云文档。` } }],
    },
  };

  // 如果第一个块是标题，在标题后面插入引用块
  // 否则在最开头插入
  const firstBlock = blocks[0];
  if (firstBlock && (firstBlock.block_type === BlockType.HEADING1 ||
      firstBlock.block_type === BlockType.HEADING2 ||
      firstBlock.block_type === BlockType.HEADING3)) {
    blocks.splice(1, 0, quoteBlock);
  } else {
    blocks.unshift(quoteBlock);
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