import { query } from "@anthropic-ai/claude-agent-sdk";
import * as lark from "@larksuiteoapi/node-sdk";
import {
  replyFinalCard,
  sendToolCard,
  updateToolCard,
  getTenantAccessToken,
} from "./client/index.js";
import type { ReplyContext, CompletionOptions } from "./client/index.js";
import { getSession, setSession } from "./session.js";
import { logger } from "./logger.js";
import { LarkccConfig, DEFAULT_OVERFLOW } from "./config.js";
import { getFormatGuideContent } from "./format/guide.js";
import { stripThinking } from "./format/thinking.js";
import { formatDuration } from "./format/time.js";
import { truncateSafely } from "./format/card-optimize.js";
import { resolveImages } from "./client/image-resolver.js";
import { TOOL_RESULT_TRUNCATE } from "./card/index.js";
import { createStreamingCard } from "./client/update.js";
import { CardKitController } from "./client/cardkit.js";
import { TaskPanelController } from "./client/task-panel-ctrl.js";
import { TOOL_LABELS } from "./shared/tool-labels.js";
import { findClaudeBinary } from "./shared/claude-binary.js";

const SILENT_TOOLS = new Set(["ExitPlanMode", "TodoWrite", "TodoRead"]);

function formatInput(name: string, input: Record<string, unknown>): string {
  if (["Read", "Write", "Edit"].includes(name))
    return String(input.file_path ?? input.path ?? "");
  if (name === "Bash") return String(input.command ?? "").slice(0, 100);
  if (name === "Grep") return `${input.pattern} in ${input.path ?? "."}`;
  if (name === "LS")   return String(input.path ?? ".");
  if (name === "Glob") return String(input.pattern ?? "");
  return JSON.stringify(input).slice(0, 100);
}

function buildReplyContext(
  config: LarkccConfig,
  profile: string | undefined,
  cwd: string,
  chatId: string,
  rootMsgId: string,
): ReplyContext {
  return {
    profile: profile ?? "default",
    cwd,
    sessionId: getSession() ?? "",
    overflow: config.overflow ?? DEFAULT_OVERFLOW,
    chatId,
    rootMsgId,
    appId: config.feishu.app_id,
    appSecret: config.feishu.app_secret,
    card_table: config.card_table,
  };
}

function buildFooterMetadata(elapsedSeconds: number, model?: string, tokens?: number, imageFailed?: number): string {
  const parts = [`⏱ ${formatDuration(elapsedSeconds)}`];
  if (model) parts.push(model);
  if (tokens) parts.push(`${tokens.toLocaleString()} tokens`);
  if (imageFailed && imageFailed > 0) parts.push(`⚠️ ${imageFailed} 张图片上传失败`);
  return parts.join(' · ');
}

/** SDK result 事件的类型定义 */
interface SDKResultEvent {
  session_id?: string;
  modelUsage?: Record<string, { inputTokens?: number; outputTokens?: number }>;
}

export interface ImageInput {
  base64: string;
  mediaType: string;
}

export type RunAgentResult = "completed" | "aborted";

// ── Agent 事件处理器上下文 ─────────────────────────────────────

interface AgentContext {
  config: LarkccConfig;
  client: lark.Client;
  chatId: string;
  rootMsgId: string;
  replyContext: ReplyContext;
  isCardkitMode: boolean;
  streamingCard: ReturnType<typeof createStreamingCard>;
  cardkitCtrl: CardKitController | null;
  taskPanelCtrl: TaskPanelController | null;
  startTime: number;
  // 可变状态
  textBuffer: string[];
  thinkingBuffer: string[];
  reasoningStartTime: number | null;
  toolCallCount: number;
  toolMsgMap: Map<string, { msgId: string; label: string; detail: string }>;
  cardkitToolResults: Array<{ id: string; name: string; label: string; detail: string; resultPreview?: string }>;
}

// ── 事件处理函数 ──────────────────────────────────────────────

function processAssistantEvent(ctx: AgentContext, blocks: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>): Promise<void>[] {
  const tasks: Promise<void>[] = [];

  for (const block of blocks) {
    if (block.type === "thinking" && block.text) {
      ctx.thinkingBuffer.push(block.text);
      logger.info(`[thinking] received ${block.text.length} chars (total: ${ctx.thinkingBuffer.reduce((s, t) => s + t.length, 0)})`);
      if (!ctx.reasoningStartTime) {
        ctx.reasoningStartTime = Date.now();
        if (ctx.isCardkitMode && ctx.cardkitCtrl) tasks.push(ctx.cardkitCtrl.updateStatus("💭 思考中..."));
      }
    }

    if (block.type === "text" && block.text) {
      ctx.textBuffer.push(block.text);
      if (ctx.cardkitCtrl) tasks.push(ctx.cardkitCtrl.append(block.text));
      else if (ctx.streamingCard) tasks.push(ctx.streamingCard.append(block.text));
    }

    if (block.type === "tool_use" && block.id && block.name) {
      ctx.toolCallCount++;
      if (SILENT_TOOLS.has(block.name)) continue;

      const label = TOOL_LABELS[block.name] ?? `🔧 ${block.name}`;
      const detail = formatInput(block.name, block.input ?? {});

      if (ctx.isCardkitMode) {
        logger.tool(block.name, detail);
        tasks.push(ctx.cardkitCtrl?.updateStatus(`<text_tag color='orange'>${label}</text_tag> \`${detail}\``) ?? Promise.resolve());
        ctx.cardkitToolResults.push({ id: block.id, name: block.name, label, detail });
        continue;
      }

      if (block.name === "AskUserQuestion") {
        const input = block.input as { questions?: Array<{ question: string }> };
        const questions = input.questions?.map(q => q.question).join("\n") ?? "";
        if (questions) tasks.push(replyFinalCard(ctx.client, ctx.chatId, ctx.rootMsgId, questions, ctx.replyContext, { cardTitle: ctx.config.card_title }));
        continue;
      }

      logger.tool(block.name, detail);
      tasks.push(sendToolCard(ctx.client, ctx.chatId, ctx.rootMsgId, label, detail, "running", block.name).then(msgId => {
        ctx.toolMsgMap.set(block.id!, { msgId, label, detail });
      }));
    }
  }

  return tasks;
}

function processUserEvent(ctx: AgentContext, blocks: Array<{ type: string; tool_use_id?: string; content?: unknown }>): Promise<void>[] {
  const tasks: Promise<void>[] = [];

  for (const block of blocks) {
    if (block.type === "tool_result" && block.tool_use_id) {
      const raw = typeof block.content === "string"
        ? block.content
        : JSON.stringify(block.content ?? "");

      if (ctx.isCardkitMode) {
        if (ctx.cardkitCtrl) tasks.push(ctx.cardkitCtrl.clearStatus());
        const toolEntry = ctx.cardkitToolResults.find(t => t.id === block.tool_use_id);
        if (toolEntry) toolEntry.resultPreview = raw;
        continue;
      }

      const toolInfo = ctx.toolMsgMap.get(block.tool_use_id);
      if (toolInfo) {
        tasks.push(updateToolCard(ctx.client, toolInfo.msgId, toolInfo.label, toolInfo.detail,
          raw.length > TOOL_RESULT_TRUNCATE ? truncateSafely(raw, TOOL_RESULT_TRUNCATE) : raw));
      }
    }
  }

  return tasks;
}

function processSystemEvent(ctx: AgentContext, event: any): Promise<void>[] {
  const tasks: Promise<void>[] = [];
  const ctrl = ctx.taskPanelCtrl;
  if (!ctrl) return tasks;

  if (event.subtype === "task_started") {
    tasks.push(ctrl.onTaskStarted(event));
  } else if (event.subtype === "task_progress") {
    tasks.push(ctrl.onTaskProgress(event));
  } else if (event.subtype === "task_notification") {
    tasks.push(ctrl.onTaskNotification(event));
  } else {
    return tasks;
  }

  const statusSummary = ctx.taskPanelCtrl?.getStatusSummary();
  if (statusSummary && ctx.isCardkitMode) {
    if (ctx.cardkitCtrl) tasks.push(ctx.cardkitCtrl.updateStatus(statusSummary));
  } else if (!statusSummary && ctx.isCardkitMode && event.subtype === "task_notification") {
    if (ctx.cardkitCtrl) tasks.push(ctx.cardkitCtrl.clearStatus());
  }

  return tasks;
}

async function processResultEvent(ctx: AgentContext, event: SDKResultEvent): Promise<void> {
  if (event.session_id) {
    setSession(event.session_id);
    logger.dim(`session saved: ${event.session_id}`);
  }

  await ctx.taskPanelCtrl?.completeAll();

  const fullText = ctx.textBuffer.join("");
  const fullThinking = ctx.thinkingBuffer.join("");

  if (!fullText) {
    return;
  }

  const elapsedSeconds = (Date.now() - ctx.startTime) / 1000;

  // 提取 model/token 信息
  let model: string | undefined;
  let tokens: number | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  if (event.modelUsage) {
    let maxTokens = 0;
    for (const [modelName, usage] of Object.entries(event.modelUsage)) {
      const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
      if (total > maxTokens) {
        maxTokens = total;
        model = modelName;
        inputTokens = usage.inputTokens;
        outputTokens = usage.outputTokens;
      }
    }
    tokens = maxTokens || undefined;
  }

  // 解析 thinking
  const thinkingEnabled = ctx.config.streaming?.thinking_enabled === true;
  const reasoningElapsedMs = ctx.reasoningStartTime ? Date.now() - ctx.reasoningStartTime : undefined;
  let finalContent: string;
  let thinking: string | undefined;

  if (thinkingEnabled) {
    finalContent = fullText;
    thinking = fullThinking || undefined;
    if (thinking) {
      logger.success(`[thinking] final: ${thinking.length} chars, ${reasoningElapsedMs ? (reasoningElapsedMs / 1000).toFixed(1) + 's' : 'no timing'}`);
    } else {
      logger.dim("[thinking] no thinking blocks received from SDK");
    }
  } else {
    finalContent = stripThinking(fullText);
  }

  // 解析图片
  let imageFailedCount = 0;
  if (finalContent && ctx.config.image_resolver?.enabled !== false) {
    try {
      const token = await getTenantAccessToken(ctx.config.feishu.app_id, ctx.config.feishu.app_secret);
      const imgResult = await resolveImages(finalContent, token);
      finalContent = imgResult.content;
      imageFailedCount = imgResult.failed;
    } catch (error) {
      console.error("[IMAGE] Image resolution failed:", error);
    }
  }

  const metadata = buildFooterMetadata(elapsedSeconds, model, tokens, imageFailedCount);

  const completeOptions: CompletionOptions = {
    metadata,
    thinking,
    reasoningElapsedMs,
    cardTitle: ctx.config.card_title,
    stats: {
      model,
      inputTokens,
      outputTokens,
      duration: elapsedSeconds,
      toolCount: ctx.toolCallCount,
    },
    headerIconImgKey: ctx.config.header_icon_img_key,
    toolResults: ctx.cardkitToolResults
      .filter(t => t.resultPreview !== undefined)
      .map(({ name, label, detail, resultPreview }) => ({ toolName: name, label, detail, resultPreview: resultPreview! })),
  };

  if (ctx.cardkitCtrl) {
    await ctx.cardkitCtrl.complete(finalContent, completeOptions);
  } else if (ctx.streamingCard) {
    await ctx.streamingCard.complete(finalContent, completeOptions);
  } else {
    await replyFinalCard(ctx.client, ctx.chatId, ctx.rootMsgId, finalContent, ctx.replyContext, completeOptions);
  }
}

// ── 主入口 ────────────────────────────────────────────────────

export async function runAgent(
  prompt: string,
  cwd: string,
  config: LarkccConfig,
  client: lark.Client,
  chatId: string,
  rootMsgId: string,
  images?: ImageInput[],
  abortController?: AbortController,
  profile?: string,
): Promise<RunAgentResult> {
  const sessionId = getSession();
  const replyContext = buildReplyContext(config, profile, cwd, chatId, rootMsgId);

  const isCardkitMode = config.streaming?.mode === "cardkit";
  let cardkitCtrl: CardKitController | null = null;
  let streamingCard = createStreamingCard(config.streaming, client, rootMsgId, replyContext, config.card_title);

  if (isCardkitMode && !streamingCard) {
    cardkitCtrl = new CardKitController({
      client,
      rootMsgId,
      cardTitle: config.card_title ?? "Claude",
      thinkingEnabled: config.streaming?.thinking_enabled === true,
      context: replyContext,
      intervalMs: config.streaming?.flush_interval_ms || 300,
      headerIconImgKey: config.header_icon_img_key,
    });
  }

  const taskPanelCtrl = config.multi_agent?.enabled !== false
    ? new TaskPanelController({ client, chatId, rootMsgId, headerIconImgKey: config.header_icon_img_key })
    : null;

  const systemPrompt = config.format_guide?.enabled !== false
    ? getFormatGuideContent()
    : undefined;

  // 构建 prompt（支持图片）
  const promptContent: Array<{ type: string; source?: { type: string; media_type: string; data: string }; text?: string }> = [];
  if (images && images.length > 0) {
    for (const img of images) {
      promptContent.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
    }
  }
  promptContent.push({ type: "text", text: prompt });

  const hasImages = images && images.length > 0;
  async function* messageGenerator(): AsyncGenerator<any> {
    yield {
      type: 'user',
      message: { role: 'user', content: promptContent },
      parent_tool_use_id: null,
      session_id: sessionId || crypto.randomUUID(),
    };
  }
  const queryPrompt = hasImages ? messageGenerator() : prompt;

  const ctx: AgentContext = {
    config, client, chatId, rootMsgId, replyContext, isCardkitMode,
    streamingCard, cardkitCtrl, taskPanelCtrl,
    startTime: Date.now(),
    textBuffer: [],
    thinkingBuffer: [],
    reasoningStartTime: null,
    toolCallCount: 0,
    toolMsgMap: new Map(),
    cardkitToolResults: [],
  };

  const handleAbort = async (logMsg: string) => {
    logger.info(logMsg);
    await taskPanelCtrl?.abortAll();
    const abortOptions = {
      content: ctx.textBuffer.join("") || undefined,
      thinking: ctx.thinkingBuffer.join("") || undefined,
      reasoningElapsedMs: ctx.reasoningStartTime ? Date.now() - ctx.reasoningStartTime : undefined,
    };
    if (cardkitCtrl) {
      await cardkitCtrl.abort(abortOptions);
    } else if (streamingCard) {
      await streamingCard.abort(abortOptions);
    } else {
      await replyFinalCard(client, chatId, rootMsgId, ctx.textBuffer.join("") || "⏹ 任务已中断", replyContext, { cardTitle: config.card_title });
    }
  };

  try {
    for await (const event of query({
      prompt: queryPrompt,
      options: {
        cwd,
        resume: sessionId,
        permissionMode: config.claude.permission_mode ?? "acceptEdits",
        allowedTools: config.claude.allowed_tools,
        thinking: config.claude.thinking,
        abortController,
        agentProgressSummaries: true,
        pathToClaudeCodeExecutable: config.claude.path || findClaudeBinary(),
        ...(systemPrompt ? { systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append: systemPrompt } } : {}),
      },
    })) {
      if (abortController?.signal.aborted) break;

      if (event.type === "assistant") {
        await Promise.all(processAssistantEvent(ctx, event.message.content as any[]));
      }

      if (event.type === "user") {
        await Promise.all(processUserEvent(ctx, (event.message.content as any[])));
      }

      if (event.type === "system" && ctx.taskPanelCtrl) {
        await Promise.all(processSystemEvent(ctx, event));
      }

      if (event.type === "result") {
        await processResultEvent(ctx, event as SDKResultEvent);
        logger.reply(chatId);
      }
    }

    if (abortController?.signal.aborted) {
      await handleAbort("Agent aborted by user");
      return "aborted";
    }
  } catch (err) {
    if (abortController?.signal.aborted) {
      await handleAbort("Agent aborted (SDK threw)");
      return "aborted";
    } else {
      console.error(`[query error]:`, err);
      throw err;
    }
  }

  return "completed";
}
