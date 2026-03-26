import { query } from "@anthropic-ai/claude-agent-sdk";
import os from "os";
import { execSync } from "child_process";
import * as lark from "@larksuiteoapi/node-sdk";
import {
  replyFinalCard,
  sendToolCard,
  updateToolCard,
} from "./feishu.js";
import { getSession, setSession } from "./session.js";
import { logger } from "./logger.js";
import { LarkccConfig } from "./config.js";

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

export interface ImageInput {
  base64: string;
  mediaType: string;
}

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
): Promise<void> {
  const sessionId = getSession();

  let textBuffer = "";
  const toolMsgMap = new Map<string, { msgId: string; label: string; detail: string }>();

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

  try {
    for await (const event of query({
      prompt: queryPrompt,
      options: {
        cwd,
        resume: sessionId,
        permissionMode: config.claude.permission_mode as "acceptEdits",
        allowedTools: config.claude.allowed_tools,
        abortSignal,
      },
    } as any)) {
    // 检查是否已中断
    if (abortSignal?.aborted) {
      logger.info("Agent aborted by user");
      await replyFinalCard(client, chatId, rootMsgId, "⏹ 任务已中断", {
        profile: profile ?? "default",
        cwd,
        sessionId: getSession() ?? "",
        overflow: config.overflow!,
        chatId,
        rootMsgId,
        appId: config.feishu.app_id,
        appSecret: config.feishu.app_secret,
      });
      break;
    }

    if (event.type === "assistant") {
      const blocks = event.message.content as Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;

      for (const block of blocks) {
        if (block.type === "text" && block.text) {
          textBuffer += block.text;
        }

        if (block.type === "tool_use" && block.id && block.name) {
          if (SILENT_TOOLS.has(block.name)) break;
          const label = TOOL_LABELS[block.name] ?? `🔧 ${block.name}`;
          if (block.name === "AskUserQuestion") {
            const input = block.input as { questions?: Array<{ question: string }> };
            const questions = input.questions?.map(q => q.question).join("\n") ?? "";
            if (questions) await replyFinalCard(client, chatId, rootMsgId, questions, {
              profile: profile ?? "default",
              cwd,
              sessionId: getSession() ?? "",
              overflow: config.overflow!,
              chatId,
              rootMsgId,
              appId: config.feishu.app_id,
              appSecret: config.feishu.app_secret,
            });
            break;
          }
          const detail = formatInput(block.name, block.input ?? {});
          logger.tool(block.name, detail);
          const msgId = await sendToolCard(client, chatId, rootMsgId, label, detail, "running", config.thinking_words);
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
      const resultEvent = event as { session_id?: string };
      if (resultEvent.session_id) {
        setSession(resultEvent.session_id);
        logger.dim(`session saved: ${resultEvent.session_id}`);
      }
      if (textBuffer) {
        await replyFinalCard(client, chatId, rootMsgId, textBuffer, {
          profile: profile ?? "default",
          cwd,
          sessionId: getSession() ?? "",
          overflow: config.overflow!,
          chatId,
          rootMsgId,
          appId: config.feishu.app_id,
          appSecret: config.feishu.app_secret,
        });
      }
      logger.reply(chatId);
    }
  }
  } catch (err) {
    console.error(`[query error]:`, err);
    throw err;
  }
}

export function ensureEnv(): void {
  if (!process.env.HOME) process.env.HOME = os.homedir();
  try {
    const shellPath = execSync("bash -lc 'echo $PATH' 2>/dev/null", { timeout: 3000 }).toString().trim();
    if (shellPath) process.env.PATH = shellPath;
  } catch {}
}