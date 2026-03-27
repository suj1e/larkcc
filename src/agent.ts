import { query } from "@anthropic-ai/claude-agent-sdk";
import os from "os";
import { execSync } from "child_process";
import * as lark from "@larksuiteoapi/node-sdk";
import {
  replyFinalCard,
  sendToolCard,
  updateToolCard,
  getTenantAccessToken,
} from "./feishu.js";
import type { ReplyContext } from "./feishu.js";
import { getSession, setSession } from "./session.js";
import { logger } from "./logger.js";
import { LarkccConfig } from "./config.js";
import { getFormatGuideContent } from "./format/guide.js";
import { stripThinking } from "./format/thinking.js";
import { formatDuration } from "./format/duration.js";
import { resolveImages } from "./format/image-resolver.js";
import { createStreamingCard } from "./streaming.js";
import type { CompleteOptions } from "./streaming.js";
import { CardKitController } from "./cardkit.js";

const TOOL_LABELS: Record<string, string> = {
  Read:            "📂 读取文件",
  Write:           "✏️  写入文件",
  Edit:            "✏️  编辑文件",
  Bash:            "⚡ 执行命令",
  Glob:            "🔍 查找文件",
  Grep:            "🔎 搜索内容",
  LS:              "📁 列出目录",
  ExitPlanMode:    "📋 退出计划模式",
  AskUserQuestion: "💬 提问",
};

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

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + "..." : str;
}

/**
 * 构建 ReplyContext（多个地方复用）
 */
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
    overflow: config.overflow!,
    chatId,
    rootMsgId,
    appId: config.feishu.app_id,
    appSecret: config.feishu.app_secret,
    card_table: config.card_table,
  };
}

/**
 * 构建底部元数据字符串
 * 格式：⏱ 8.2s · Claude Sonnet 4 · 1,234 tokens · ⚠️ 2 张图片上传失败
 */
function buildFooterMetadata(elapsedSeconds: number, model?: string, tokens?: number, imageFailed?: number): string {
  const parts = [`⏱ ${formatDuration(elapsedSeconds)}`];
  if (model) parts.push(model);
  if (tokens) parts.push(`${tokens.toLocaleString()} tokens`);
  if (imageFailed && imageFailed > 0) parts.push(`⚠️ ${imageFailed} 张图片上传失败`);
  return parts.join(' · ');
}

export interface ImageInput {
  base64: string;
  mediaType: string;
}

/** SDK result 事件的类型定义 */
interface SDKResultEvent {
  session_id?: string;
  modelUsage?: Record<string, { inputTokens?: number; outputTokens?: number }>;
}

export type RunAgentResult = "completed" | "aborted";

export async function runAgent(
  prompt: string,
  cwd: string,
  config: LarkccConfig,
  client: lark.Client,
  chatId: string,
  rootMsgId: string,
  images?: ImageInput[],
  abortSignal?: AbortSignal,   // 可选中断信号
  profile?: string              // 机器人配置名
): Promise<RunAgentResult> {
  const sessionId = getSession();
  const startTime = Date.now();

  let textBuffer = "";
  let thinkingBuffer = "";
  let reasoningStartTime: number | null = null;
  const toolMsgMap = new Map<string, { msgId: string; label: string; detail: string }>();

  // 构建 ReplyContext
  const replyContext = buildReplyContext(config, profile, cwd, chatId, rootMsgId);

  // 创建流式控制器
  // CardKit 模式：单卡片架构，不发工具卡片
  // Update 模式：message.patch 模拟流式，保留工具卡片
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
    });
  }

  // 构建格式指导 system prompt（追加到 Claude Code 默认 system prompt 后面）
  const systemPrompt = config.format_guide?.enabled !== false
    ? getFormatGuideContent()
    : undefined;

  // 构建 prompt content（支持图片）
  const promptContent: any[] = [];
  if (images && images.length > 0) {
    for (const img of images) {
      promptContent.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.base64 },
      });
    }
  }
  promptContent.push({ type: "text", text: prompt });

  // 如果有图片，使用 AsyncIterable<SDKUserMessage> 格式
  // 否则使用普通字符串
  const hasImages = images && images.length > 0;

  async function* messageGenerator(): AsyncGenerator<any> {
    yield {
      type: 'user',
      message: {
        role: 'user',
        content: promptContent,
      },
      parent_tool_use_id: null,
      session_id: sessionId || crypto.randomUUID(),
    };
  }

  const queryPrompt = hasImages ? messageGenerator() : prompt;

  // abort 处理（统一入口，保留已有内容）
  const handleAbort = async (logMsg: string) => {
    logger.info(logMsg);
    const reasoningElapsedMs = reasoningStartTime ? Date.now() - reasoningStartTime : undefined;
    const abortOptions = {
      content: textBuffer || undefined,
      thinking: thinkingBuffer || undefined,
      reasoningElapsedMs,
    };
    if (cardkitCtrl) {
      await cardkitCtrl.abort(abortOptions);
    } else if (streamingCard) {
      await streamingCard.abort(abortOptions);
    } else {
      await replyFinalCard(client, chatId, rootMsgId, textBuffer || "⏹ 任务已中断", replyContext, { cardTitle: config.card_title });
    }
  };

  try {
    for await (const event of query({
      prompt: queryPrompt,
      options: {
        cwd,
        resume: sessionId,
        permissionMode: config.claude.permission_mode as "acceptEdits",
        allowedTools: config.claude.allowed_tools,
        abortSignal,
        ...(systemPrompt ? { systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append: systemPrompt } } : {}),
      },
    } as any)) {
    // 检查是否已中断（循环内快速路径）
    if (abortSignal?.aborted) break;

    if (event.type === "assistant") {
      const blocks = event.message.content as Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;

      for (const block of blocks) {
        if (block.type === "thinking" && block.text) {
          thinkingBuffer += block.text;
          if (!reasoningStartTime) reasoningStartTime = Date.now();
        }

        if (block.type === "text" && block.text) {
          textBuffer += block.text;
          // CardKit 模式：单卡片流式追加
          if (cardkitCtrl) await cardkitCtrl.append(block.text);
          // Update 模式：流式追加
          else if (streamingCard) await streamingCard.append(block.text);
        }

        if (block.type === "tool_use" && block.id && block.name) {
          // CardKit 模式：更新状态栏，不发工具卡片
          if (isCardkitMode) {
            if (SILENT_TOOLS.has(block.name)) break;
            const label = TOOL_LABELS[block.name] ?? `🔧 ${block.name}`;
            const detail = formatInput(block.name, block.input ?? {});
            logger.tool(block.name, detail);
            await cardkitCtrl?.updateStatus(`🔄 ${label} ${detail}`);
            break;
          }
          if (SILENT_TOOLS.has(block.name)) break;
          const label = TOOL_LABELS[block.name] ?? `🔧 ${block.name}`;
          if (block.name === "AskUserQuestion") {
            const input = block.input as { questions?: Array<{ question: string }> };
            const questions = input.questions?.map(q => q.question).join("\n") ?? "";
            if (questions) await replyFinalCard(client, chatId, rootMsgId, questions, replyContext, { cardTitle: config.card_title });
            break;
          }
          const detail = formatInput(block.name, block.input ?? {});
          logger.tool(block.name, detail);
          const msgId = await sendToolCard(client, chatId, rootMsgId, label, detail, "running", block.name);
          toolMsgMap.set(block.id, { msgId, label, detail });
        }
      }
    }

    if (event.type === "user") {
      const blocks = event.message.content as Array<{
        type: string;
        tool_use_id?: string;
        content?: unknown;
      }>;
      for (const block of blocks) {
        if (block.type === "tool_result" && block.tool_use_id) {
          // CardKit 模式：清除工具状态
          if (isCardkitMode) {
            await cardkitCtrl?.clearStatus();
            break;
          }
          const toolInfo = toolMsgMap.get(block.tool_use_id);
          if (toolInfo) {
            const raw = typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content ?? "");
            await updateToolCard(client, toolInfo.msgId, toolInfo.label, toolInfo.detail, truncate(raw, 500));
          }
        }
      }
    }

    if (event.type === "result") {
      const resultEvent = event as SDKResultEvent;
      if (resultEvent.session_id) {
        setSession(resultEvent.session_id);
        logger.dim(`session saved: ${resultEvent.session_id}`);
      }

      if (textBuffer) {
        // 计算耗时
        const elapsedSeconds = (Date.now() - startTime) / 1000;

        // 尝试从 SDK result 中提取 token 和 model 信息
        // model 信息在 modelUsage 的 key 中，取使用最多 token 的 model
        const modelUsage = resultEvent.modelUsage;
        let model: string | undefined;
        let tokens: number | undefined;
        if (modelUsage) {
          let maxTokens = 0;
          for (const [modelName, usage] of Object.entries(modelUsage)) {
            const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
            if (total > maxTokens) {
              maxTokens = total;
              model = modelName;
            }
          }
          tokens = maxTokens || undefined;
        }

        // 解析 thinking（thinking blocks 已在事件循环中单独捕获）
        const thinkingEnabled = config.streaming?.thinking_enabled === true;
        const reasoningElapsedMs = reasoningStartTime ? Date.now() - reasoningStartTime : undefined;
        let finalContent: string;
        let thinking: string | undefined;

        if (thinkingEnabled) {
          finalContent = textBuffer;
          thinking = thinkingBuffer || undefined;
        } else {
          finalContent = stripThinking(textBuffer);
        }

        // 解析图片（下载外部图片上传到飞书）
        let imageFailedCount = 0;
        if (finalContent && config.image_resolver?.enabled !== false) {
          try {
            const token = await getTenantAccessToken(config.feishu.app_id, config.feishu.app_secret);
            const imgResult = await resolveImages(finalContent, token);
            finalContent = imgResult.content;
            imageFailedCount = imgResult.failed;
          } catch (error) {
            console.error("[IMAGE] Image resolution failed:", error);
            // 继续发送，不阻断流程
          }
        }

        // 构建元数据（一次性构建，避免可变拼接）
        const metadata = buildFooterMetadata(elapsedSeconds, model, tokens, imageFailedCount);

        const completeOptions: CompleteOptions = {
          metadata,
          thinking,
          reasoningElapsedMs,
          cardTitle: config.card_title,
        };

        if (cardkitCtrl) {
          // CardKit 模式：单卡片完成
          await cardkitCtrl.complete(finalContent, completeOptions);
        } else if (streamingCard) {
          // Update 模式：最终更新卡片（内部处理 overflow）
          await streamingCard.complete(finalContent, completeOptions);
        } else {
          await replyFinalCard(client, chatId, rootMsgId, finalContent, replyContext, completeOptions);
        }
      }
      logger.reply(chatId);
    }
    }

    // 循环外统一处理 abort（覆盖 SDK 抛异常或正常退出的情况）
    if (abortSignal?.aborted) {
      await handleAbort("Agent aborted by user");
      return "aborted";
    }
  } catch (err) {
    if (abortSignal?.aborted) {
      await handleAbort("Agent aborted (SDK threw)");
      return "aborted";
    } else {
      console.error(`[query error]:`, err);
      throw err;
    }
  }

  return "completed";
}

export function ensureEnv(): void {
  if (!process.env.HOME) process.env.HOME = os.homedir();
  try {
    const shellPath = execSync("bash -lc 'echo $PATH' 2>/dev/null", { timeout: 3000 }).toString().trim();
    if (shellPath) process.env.PATH = shellPath;
  } catch {}
}
