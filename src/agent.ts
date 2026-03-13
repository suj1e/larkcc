import { query } from "@anthropic-ai/claude-code";
import * as lark from "@larksuiteoapi/node-sdk";
import {
  sendText,
  updateText,
  updateCard,
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

// 格式化工具调用入参，用于日志和卡片展示
function formatInput(name: string, input: Record<string, unknown>): string {
  if (["Read", "Write", "Edit"].includes(name))
    return String(input.file_path ?? input.path ?? "");
  if (name === "Bash") return String(input.command ?? "").slice(0, 100);
  if (name === "Grep") return `${input.pattern} in ${input.path ?? "."}`;
  if (name === "LS") return String(input.path ?? ".");
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

  // ── 状态 ────────────────────────────────────────────────────
  let textMsgId: string | null = null;
  let textBuffer = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  // tool_use_id → { msgId, label, detail }
  const toolMsgMap = new Map<string, { msgId: string; label: string; detail: string }>();

  // ── 节流刷新文字消息（模拟流式） ────────────────────────────
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

  // ── SDK 事件循环 ─────────────────────────────────────────────
  for await (const event of query({
    prompt,
    options: {
      cwd,
      resume: sessionId,
      permissionMode: config.claude.permission_mode as "acceptEdits",
      allowedTools: config.claude.allowed_tools,
    },
  })) {
    switch (event.type) {

      // Claude 正在输出文字 → 节流更新飞书消息
      case "assistant": {
        for (const block of (event.message as { content: Array<{ type: string; text?: string }> }).content) {
          if (block.type === "text" && block.text) {
            textBuffer += block.text;
            scheduleFlush();
          }
        }
        break;
      }

      // 工具调用开始 → 先刷出积压文字，再发工具卡片
      case "tool_use": {
        await flush(false);
        const label = TOOL_LABELS[(event as { name: string }).name] ?? `🔧 ${(event as { name: string }).name}`;
        const detail = formatInput((event as { name: string; input: Record<string, unknown> }).name, (event as { name: string; input: Record<string, unknown> }).input);
        logger.tool((event as { name: string }).name, detail);
        const msgId = await sendToolCard(client, chatId, label, detail, "running");
        toolMsgMap.set((event as { id: string }).id, { msgId, label, detail });
        break;
      }

      // 工具结果 → 更新卡片，折叠展示结果
      case "tool_result": {
        const toolInfo = toolMsgMap.get((event as { tool_use_id: string }).tool_use_id);
        if (toolInfo) {
          const raw = String((event as { content: unknown }).content ?? "");
          const preview = truncate(raw, 500);
          await updateToolCard(client, toolInfo.msgId, toolInfo.label, toolInfo.detail, preview);
        }
        break;
      }

      // 最终结果 → 保存 session，文字消息替换为富文本卡片
      case "result": {
        if (flushTimer) clearTimeout(flushTimer);

        const sessionEvent = event as { session_id?: string };
        if (sessionEvent.session_id) {
          setSession(sessionEvent.session_id);
          logger.dim(`session saved: ${sessionEvent.session_id}`);
        }

        if (textBuffer) {
          if (!textMsgId) {
            textMsgId = await sendText(client, chatId, "...");
          }
          await updateCard(client, textMsgId, textBuffer);
        }

        logger.reply(chatId);
        break;
      }
    }
  }
}
