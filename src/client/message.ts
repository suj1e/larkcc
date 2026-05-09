import * as lark from "@larksuiteoapi/node-sdk";
import { OverflowConfig, CardTableConfig } from "../config.js";
import { sanitizeContent, formatWarnings, countTables, optimizeForCard } from "../format/index.js";
import { buildCard, buildSimpleCard, buildMarkdownCard, buildThinkingPanel, collapsiblePanel, markdown, hr, buildHeader, buildFooterElement, buildStatsTags } from "../card/index.js";
import type { CardBuildOptions } from "../card/index.js";
import { getTenantAccessToken, checkTokenExpiry } from "./lark.js";
import { createOverflowDocument, registerDocument, cleanupOldDocuments } from "./document.js";
import type { DocumentMeta } from "../format/index.js";

// ── 共享类型 ──────────────────────────────────────────────────

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

export interface ReplyFinalOptions {
  metadata?: string;
  thinking?: string;
  reasoningElapsedMs?: number;
  cardTitle?: string;
  stats?: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    duration?: number;
    toolCount?: number;
  };
  headerIconImgKey?: string;
  toolResults?: Array<{ toolName: string; label: string; detail: string; resultPreview: string }>;
}

/** 回复完成选项（别名，供流式模块使用） */
export type CompletionOptions = ReplyFinalOptions;

export type { CardBuildOptions } from "../card/index.js";

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

// ── 最终回复卡片 ─────────────────────────────────────────────

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
    let cut = remaining.lastIndexOf("\n", size);
    if (cut < size * 0.5) cut = remaining.lastIndexOf(" ", size);
    if (cut < size * 0.5) cut = size;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  return chunks;
}

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

    if (/^#{1,6}\s/.test(trimmed)) {
      if (tableCount >= maxTables && !inTable) {
        flushChunk();
        tableCount = 0;
      }
      pendingHeading = line;
      continue;
    }

    if (isTableRow(trimmed) && !inTable) {
      if (i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        if (tableCount >= maxTables) {
          flushChunk();
          tableCount = 0;
        }
        if (pendingHeading) {
          currentChunk.push(pendingHeading);
          pendingHeading = null;
        }
        inTable = true;
        tableCount++;
      }
    }

    if (pendingHeading && !isTableRow(trimmed)) {
      currentChunk.push(pendingHeading);
      pendingHeading = null;
    }

    currentChunk.push(line);

    if (inTable && !isTableRow(trimmed) && !isTableSeparator(trimmed)) {
      inTable = false;
    }
  }

  if (pendingHeading) {
    currentChunk.push(pendingHeading);
  }
  flushChunk();

  return chunks;
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

  if (tableCount > maxTablesPerCard) {
    if (context?.overflow.mode === "document" && markdown.length > threshold) {
      await replyWithDocument(client, chatId, rootMsgId, markdown, context, options);
    } else {
      const chunks = splitMarkdownByTables(markdown, maxTablesPerCard);
      for (const chunk of chunks) {
        await sendMessageChunk(client, rootMsgId, chunk);
      }
    }
    return;
  }

  if (markdown.length <= threshold) {
    const finalContent = options?.metadata
      ? `${markdown}\n\n---\n${options.metadata}`
      : markdown;
    await sendMessageChunk(client, rootMsgId, finalContent, options?.thinking, options?.cardTitle);
    return;
  }

  if (context?.overflow.mode === "document") {
    await replyWithDocument(client, chatId, rootMsgId, markdown, context, options);
  } else {
    const chunks = splitMarkdown(markdown, context?.overflow.chunk.threshold ?? CHUNK_SIZE);
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const content = chunks.length > 1
        ? `**(${i + 1}/${chunks.length})**\n${chunks[i]}`
        : chunks[i];
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
  const { content: sanitizedContent, warnings } = sanitizeContent(content);

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
    await (client.im.message as any).reply({
      path: { message_id: rootMsgId },
      data: { content: JSON.stringify({ text: finalContent }), msg_type: "text", reply_in_thread: false },
    });
  }
}

// ── 溢出文档辅助 ─────────────────────────────────────────────

export async function prepareOverflowContext(
  client: lark.Client,
  rootMsgId: string,
  context: ReplyContext,
): Promise<{ token: string; title: string; originalMessage: string; meta: DocumentMeta }> {
  checkTokenExpiry();
  const token = await getTenantAccessToken(context.appId, context.appSecret);

  const now = new Date();
  const y = now.getFullYear(), mo = String(now.getMonth() + 1).padStart(2, "0"), d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0"), mi = String(now.getMinutes()).padStart(2, "0"), s = String(now.getSeconds()).padStart(2, "0");
  const datetime = `${y}-${mo}-${d} ${h}:${mi}:${s}`;
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
  } catch {}

  const meta: DocumentMeta = {
    cwd: context.cwd,
    profile: context.profile,
    sessionId: context.sessionId ?? "",
    datetime,
  };

  return { token, title, originalMessage, meta };
}

async function patchOrCreateCard(
  client: lark.Client,
  waitingMsgId: string | undefined,
  rootMsgId: string,
  content: string,
): Promise<boolean> {
  if (waitingMsgId) {
    try {
      const card = buildMarkdownCard(content);
      await (client.im.message as any).patch({
        path: { message_id: waitingMsgId },
        data: { content: JSON.stringify(card) },
      });
      return true;
    } catch {}
  }
  await sendMessageChunk(client, rootMsgId, content);
  return true;
}

async function replyWithDocument(
  client: lark.Client,
  chatId: string,
  rootMsgId: string,
  markdown: string,
  context: ReplyContext,
  options?: ReplyFinalOptions,
): Promise<void> {
  const stats = options?.stats;
  const cardTitle = options?.cardTitle ?? "Claude";

  let waitingMsgId: string | undefined;
  try {
    const waitingCard = buildMarkdownCard("📝 内容较长，正在写入云文档...");
    const waitRes = await (client.im.message as any).reply({
      path: { message_id: rootMsgId },
      data: { content: JSON.stringify(waitingCard), msg_type: "interactive", reply_in_thread: false },
    });
    waitingMsgId = waitRes?.data?.message_id;
  } catch {}

  try {
    const { token, title, originalMessage, meta } = await prepareOverflowContext(client, rootMsgId, context);

    const cleanupConfig = context.overflow.document.cleanup;
    await cleanupOldDocuments(token, cleanupConfig.max_docs, context.profile);

    const { docUrl, docId, warnings: docWarnings } = await createOverflowDocument(token, title, markdown, originalMessage, meta);

    registerDocument(docId, context.profile);

    let replyMsg = `📝 内容较长，已写入云文档：${docUrl}`;
    if (docWarnings.length > 0) {
      replyMsg += `\n⚠️ ${docWarnings.join("；")}`;
    }

    const elements: any[] = [{ tag: "markdown", content: replyMsg }];
    const footer = buildFooterElement({
      inputTokens: stats?.inputTokens,
      outputTokens: stats?.outputTokens,
      toolCount: stats?.toolCount,
    });
    if (footer) {
      elements.push({ tag: "hr" }, footer);
    }

    const docCard: any = {
      schema: "2.0",
      config: { wide_screen_mode: true },
      header: buildHeader({
        title: cardTitle,
        subtitle: "内容已写入云文档",
        template: "green",
        iconImgKey: options?.headerIconImgKey,
        tags: buildStatsTags(stats ?? {}),
      }),
      body: { elements },
    };

    if (waitingMsgId) {
      try {
        await (client.im.message as any).patch({
          path: { message_id: waitingMsgId },
          data: { content: JSON.stringify(docCard) },
        });
        return;
      } catch {}
    }
    await sendMessageChunk(client, rootMsgId, replyMsg);
  } catch (error) {
    console.error("Failed to create document:", error);
    const errorMsg = `❌ 写入云文档失败：${error}，回退到分片发送`;
    const patched = await patchOrCreateCard(client, waitingMsgId, rootMsgId, errorMsg);
    if (patched) return;
    const chunks = splitMarkdown(markdown, CHUNK_SIZE);
    for (let i = 0; i < chunks.length; i++) {
      const content = `**(${i + 1}/${chunks.length})**\n${chunks[i]}`;
      await sendMessageChunk(client, rootMsgId, content);
    }
  }
}

// ── 工具卡片 ─────────────────────────────────────────────────

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
  resultPreview: string
): Promise<void> {
  const elements: any[] = [
    markdown(`${label}\n\`${detail}\``),
  ];

  if (resultPreview.trim()) {
    elements.push(collapsiblePanel({
      title: { tag: "plain_text", content: "📋 查看结果" },
      backgroundColor: "grey",
      iconPosition: "right",
      elements: [markdown(resultPreview, { text_size: "notation" })],
    }));
  }

  const card = buildCard({
    elements,
    config: { wide_screen_mode: true },
  });

  await client.im.message.patch({
    path: { message_id: msgId },
    data: { content: JSON.stringify(card) },
  });
}

// ── 卡片构建 ─────────────────────────────────────────────────
// buildMarkdownCard 已迁移至 ../card/card.ts，通过 barrel re-export 使用

// ── 发送辅助 ─────────────────────────────────────────────────

export async function sendMarkdownCardMessage(
  client: lark.Client,
  chatId: string,
  content: string,
  options?: {
    rootMsgId?: string;
    reply?: boolean;
  },
): Promise<void> {
  const { content: sanitizedContent, warnings } = sanitizeContent(content);
  const card = buildSimpleCard(sanitizedContent, warnings);

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
