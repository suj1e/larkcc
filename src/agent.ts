import { query } from "@anthropic-ai/claude-agent-sdk";
import os from "os";
import { execSync } from "child_process";
import * as lark from "@larksuiteoapi/node-sdk";
import {
  replyText,
  updateText,
  replyFinalCard,
  sendToolCard,
  updateToolCard,
} from "./feishu.js";
import { getSession, setSession } from "./session.js";
import { logger } from "./logger.js";
import { LarkccConfig } from "./config.js";

const TOOL_LABELS: Record<string, string> = {
  Read:  "📂 读取文件",
  Write: "✏️  写入文件",
  Edit:  "✏️  编辑文件",
  Bash:  "⚡ 执行命令",
  Glob:  "🔍 查找文件",
  Grep:  "🔎 搜索内容",
  LS:    "📁 列出目录",
};

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

export async function runAgent(
  prompt: string,
  cwd: string,
  config: LarkccConfig,
  client: lark.Client,
  chatId: string,
  rootMsgId: string       // 用户原始消息 id，所有回复都 thread 到这里
): Promise<void> {
  const sessionId = getSession();

  let textMsgId: string | null = null;
  let textBuffer = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const toolMsgMap = new Map<string, { msgId: string; label: string; detail: string }>();

  const flush = async (final = false): Promise<void> => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!textBuffer) return;
    const content = textBuffer + (final ? "" : " ▌");
    if (!textMsgId) {
      textMsgId = await replyText(client, chatId, rootMsgId, content);
    } else {
      await updateText(client, textMsgId, content);
    }
  };

  const scheduleFlush = (): void => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => flush(), 300);
  };

  for await (const event of query({
    prompt,
    options: {
      cwd,
      resume: sessionId,
      permissionMode: config.claude.permission_mode as "acceptEdits",
      allowedTools: config.claude.allowed_tools,
    },
  })) {
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
          scheduleFlush();
        }

        if (block.type === "tool_use" && block.id && block.name) {
          await flush(false);
          const label  = TOOL_LABELS[block.name] ?? `🔧 ${block.name}`;
          const detail = formatInput(block.name, block.input ?? {});
          logger.tool(block.name, detail);
          const msgId = await sendToolCard(client, chatId, rootMsgId, label, detail, "running");
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
            const raw     = typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content ?? "");
            const preview = truncate(raw, 500);
            await updateToolCard(client, toolInfo.msgId, toolInfo.label, toolInfo.detail, preview);
          }
        }
      }
    }

    if (event.type === "result") {
      if (flushTimer) clearTimeout(flushTimer);

      const resultEvent = event as { session_id?: string };
      if (resultEvent.session_id) {
        setSession(resultEvent.session_id);
        logger.dim(`session saved: ${resultEvent.session_id}`);
      }

      if (textBuffer) {
        if (textMsgId) await updateText(client, textMsgId, textBuffer); // 清除光标
        await replyFinalCard(client, chatId, rootMsgId, textBuffer);
      }

      logger.reply(chatId);
    }
  }
}

// 确保子进程能读到 ~/.claude/ 登录态
export function ensureEnv(): void {
  if (!process.env.HOME) {
    process.env.HOME = os.homedir();
  }
  try {
    const shellPath = execSync("bash -lc 'echo $PATH' 2>/dev/null", {
      timeout: 3000,
    }).toString().trim();
    if (shellPath) process.env.PATH = shellPath;
  } catch {}
}