/**
 * 飞书卡片 — 任务面板卡片构建器
 *
 * 从 feishu/task-panel.ts 迁移而来。
 * 纯卡片 JSON 构建，不含 API 调用。
 */

import { buildCard } from "./compose.js";
import { markdown } from "./elements.js";
import { buildHeader } from "./header.js";
import { TASK_SUMMARY_TRUNCATE } from "./containers.js";
import { TOOL_DISPLAY } from "../shared/tool-labels.js";

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

export function buildTaskPanelCard(options: TaskPanelCardOptions) {
  const { description, status, summary, lastToolName, toolsUsed, elapsedSeconds, tokens, headerIconImgKey } = options;
  const st = STATUS_TEMPLATE[status];
  const isTerminal = status !== "running";

  const elements: Record<string, unknown>[] = [];

  // Status line
  const statusParts: string[] = [`**${st.icon} ${st.label}**`];
  if (lastToolName && status === "running") statusParts.push(`\`${lastToolName}\``);
  elements.push(markdown(statusParts.join(" · ")));

  // Tool sequence
  if (toolsUsed && toolsUsed.length > 0) {
    elements.push(markdown(formatToolSequence(toolsUsed, isTerminal), { text_size: "notation" }));
  }

  // Summary
  if (summary && summary !== "Done" && summary !== "Aborted") {
    elements.push(markdown(summary.length > TASK_SUMMARY_TRUNCATE ? summary.slice(0, TASK_SUMMARY_TRUNCATE) + "..." : summary));
  } else if (status === "running") {
    elements.push(markdown("Processing..."));
  }

  // Header tags (replaces footer — avoids duplication)
  const tags: Array<{ text: string; color: string }> = [];
  if (elapsedSeconds != null) tags.push({ text: fmtDur(elapsedSeconds), color: "turquoise" });
  if (isTerminal && tokens != null) tags.push({ text: `${tokens.toLocaleString()} tokens`, color: "blue" });

  return buildCard({
    elements,
    config: { wide_screen_mode: true },
    header: buildHeader({
      title: description,
      subtitle: "🤖 Sub Agent",
      template: st.color,
      iconImgKey: headerIconImgKey,
      tags,
    }),
  });
}
