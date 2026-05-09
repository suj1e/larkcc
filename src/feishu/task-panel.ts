import * as lark from "@larksuiteoapi/node-sdk";
import { buildHeader } from "../format/card.js";
import { TASK_SUMMARY_TRUNCATE } from "../format/duration.js";

// ── 任务面板卡片 ─────────────────────────────────────────────

export type TaskPanelStatus = "running" | "completed" | "failed" | "stopped";

export interface TaskPanelCardOptions {
  description: string;
  status: TaskPanelStatus;
  summary?: string;
  lastToolName?: string;
  toolsUsed?: string[];
  elapsedSeconds?: number;
  tokens?: number;
  headerIconImgKey?: string;
}

const STATUS_TEMPLATE: Record<TaskPanelStatus, { color: string; icon: string; label: string }> = {
  running:  { color: "turquoise", icon: "🔄", label: "Running" },
  completed: { color: "green",    icon: "✅", label: "Completed" },
  failed:   { color: "red",      icon: "❌", label: "Failed" },
  stopped:  { color: "grey",     icon: "⏹",  label: "Stopped" },
};

const TOOL_DISPLAY: Record<string, string> = {
  Read: "📂 Read", Write: "📝 Write", Edit: "✏️ Edit",
  Bash: "⚡ Bash", Glob: "📂 Glob", Grep: "🔍 Grep",
  LS: "📁 LS",
};

function fmtDur(sec: number): string {
  return sec < 60
    ? `${sec.toFixed(0)}s`
    : `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

function formatToolSequence(toolsUsed: string[], isTerminal: boolean): string {
  if (toolsUsed.length === 0) return "";

  if (!isTerminal) {
    return toolsUsed.map(t => TOOL_DISPLAY[t] ?? `🔧 ${t}`).join(" → ");
  }

  // Terminal state: merge consecutive duplicates with counts
  const merged: string[] = [];
  let current = toolsUsed[0];
  let count = 1;
  for (let i = 1; i < toolsUsed.length; i++) {
    if (toolsUsed[i] === current) {
      count++;
    } else {
      const label = TOOL_DISPLAY[current] ?? `🔧 ${current}`;
      merged.push(count > 1 ? `${label} ×${count}` : label);
      current = toolsUsed[i];
      count = 1;
    }
  }
  const lastLabel = TOOL_DISPLAY[current] ?? `🔧 ${current}`;
  merged.push(count > 1 ? `${lastLabel} ×${count}` : lastLabel);
  return merged.join(" → ");
}

function buildTaskPanelCard(options: TaskPanelCardOptions) {
  const { description, status, summary, lastToolName, toolsUsed, elapsedSeconds, tokens, headerIconImgKey } = options;
  const st = STATUS_TEMPLATE[status];
  const isTerminal = status !== "running";

  const elements: any[] = [];

  // Status line
  const statusParts: string[] = [`**${st.icon} ${st.label}**`];
  if (lastToolName && status === "running") statusParts.push(`\`${lastToolName}\``);
  elements.push({ tag: "markdown", content: statusParts.join(" · ") });

  // Tool sequence
  if (toolsUsed && toolsUsed.length > 0) {
    elements.push({ tag: "markdown", content: formatToolSequence(toolsUsed, isTerminal), text_size: "notation" });
  }

  // Summary
  if (summary && summary !== "Done" && summary !== "Aborted") {
    elements.push({ tag: "markdown", content: summary.length > TASK_SUMMARY_TRUNCATE ? summary.slice(0, TASK_SUMMARY_TRUNCATE) + "..." : summary });
  } else if (status === "running") {
    elements.push({ tag: "markdown", content: "Processing..." });
  }

  // Header tags (replaces footer — avoids duplication)
  const tags: Array<{ text: string; color: string }> = [];
  if (elapsedSeconds != null) tags.push({ text: fmtDur(elapsedSeconds), color: "turquoise" });
  if (isTerminal && tokens != null) tags.push({ text: `${tokens.toLocaleString()} tokens`, color: "blue" });

  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: buildHeader({
      title: description,
      subtitle: "🤖 Sub Agent",
      template: st.color,
      iconImgKey: headerIconImgKey,
      tags,
    }),
    body: { elements },
  };
}

export async function sendTaskCard(
  client: lark.Client,
  chatId: string,
  rootMsgId: string,
  description: string,
  headerIconImgKey?: string,
): Promise<string> {
  const card = buildTaskPanelCard({ description, status: "running", headerIconImgKey });
  const res = await (client.im.message as any).reply({
    path: { message_id: rootMsgId },
    data: { content: JSON.stringify(card), msg_type: "interactive", reply_in_thread: false },
  });
  return res.data?.message_id ?? "";
}

export async function updateTaskCard(
  client: lark.Client,
  msgId: string,
  options: TaskPanelCardOptions,
): Promise<void> {
  const card = buildTaskPanelCard(options);
  await client.im.message.patch({
    path: { message_id: msgId },
    data: { content: JSON.stringify(card) },
  });
}
