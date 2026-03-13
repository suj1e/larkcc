import { query } from "@anthropic-ai/claude-agent-sdk";
import os from "os";
import { execSync } from "child_process";
import * as lark from "@larksuiteoapi/node-sdk";
import {
  sendText,
  updateText,
  sendFinalCard,
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
  chatId: string
): Promise<void> {
  const sessionId = getSession();

  let textMsgId: string | null = null;
  let textBuffer = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  // tool_use_id → { msgId, label, detail }
  const toolMsgMap = new Map<string, { msgId: string; label: string; detail: string }>();

  const flush = async (final = false): Promise<void> => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!textBuffer) return;
    const content = textBuffer + (final ? "" : " ▌");
    if (!textMsgId) {
      textMsgId = await sendText(client, chatId, content);
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
    // assistant 消息：文字块 + 工具调用块都在 message.content 里
    if (event.type === "assistant") {
      const blocks = event.message.content as Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;

      for (const block of blocks) {
        // 文字块 → 节流刷新飞书消息（模拟流式）
        if (block.type === "text" && block.text) {
          textBuffer += block.text;
          scheduleFlush();
        }

        // 工具调用块 → 先刷出积压文字，再发独立工具卡片
        if (block.type === "tool_use" && block.id && block.name) {
          await flush(false);
          const label  = TOOL_LABELS[block.name] ?? `🔧 ${block.name}`;
          const detail = formatInput(block.name, block.input ?? {});
          logger.tool(block.name, detail);
          const msgId = await sendToolCard(client, chatId, label, detail, "running");
          toolMsgMap.set(block.id, { msgId, label, detail });
        }
      }
    }

    // user 消息里含 tool_result → 更新工具卡片为完成态（折叠展示结果）
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

    // 最终结果 → 保存 session，文字消息替换为富文本卡片
    if (event.type === "result") {
      if (flushTimer) clearTimeout(flushTimer);

      const resultEvent = event as { session_id?: string };
      if (resultEvent.session_id) {
        setSession(resultEvent.session_id);
        logger.dim(`session saved: ${resultEvent.session_id}`);
      }

      if (textBuffer) {
        if (!textMsgId) textMsgId = await sendText(client, chatId, "...");
        await sendFinalCard(client, chatId, textBuffer);
      }

      logger.reply(chatId);
    }
  }
}

// 确保子进程能读到 ~/.claude/ 登录态
export function ensureEnv(): void {
  // 补全 HOME，确保 claude 能找到 ~/.claude/settings.json
  if (!process.env.HOME) {
    process.env.HOME = os.homedir();
  }
  // 补全 PATH：从 shell 里读完整的 PATH
  try {
    const shellPath = execSync("bash -lc 'echo $PATH' 2>/dev/null", {
      timeout: 3000,
    }).toString().trim();
    if (shellPath) process.env.PATH = shellPath;
  } catch {}
}
