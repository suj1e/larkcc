/**
 * 飞书卡片 JSON v2 — 容器组件
 *
 * collapsiblePanel, columnSet, column 等容器级 builder，
 * 以及基于它们的业务面板构建函数。
 */

import { markdown, plainText, standardIcon, hr } from "./elements.js";
import { truncateSafely } from "../format/card-optimize.js";
import { formatReasoningDuration } from "../format/time.js";
import type { MarkdownOptions } from "./elements.js";

// ── 截断阈值 ───────────────────────────────────────────────────

/** Thinking 内容截断阈值（字符数） */
export const THINKING_OVERFLOW_TRUNCATE = 3000;

/** 工具结果截断阈值（字符数） */
export const TOOL_RESULT_TRUNCATE = 2000;

/** 任务面板 summary 截断阈值（字符数） */
export const TASK_SUMMARY_TRUNCATE = 3000;

// ── 通用折叠面板（collapsible_panel） ──────────────────────────

export interface CollapsiblePanelOptions {
  title: string | Record<string, unknown>;
  backgroundColor?: string;
  expanded?: boolean;
  iconPosition?: string;
  elements: Record<string, unknown>[];
  border?: { color: string; corner_radius: string };
  padding?: string;
}

export function collapsiblePanel(options: CollapsiblePanelOptions): Record<string, unknown> {
  const panel: Record<string, unknown> = {
    tag: "collapsible_panel",
    expanded: options.expanded ?? false,
    background_color: options.backgroundColor ?? "grey",
    header: {
      title: typeof options.title === "string"
        ? markdown(options.title)
        : options.title,
      vertical_align: "center",
      icon: standardIcon("down-small-ccm_outlined", "16px 16px"),
      icon_position: options.iconPosition ?? "right",
      icon_expanded_angle: -180,
    },
    border: options.border ?? { color: "grey", corner_radius: "5px" },
    vertical_spacing: "8px",
    padding: options.padding ?? "8px 8px 8px 8px",
    elements: options.elements,
  };
  return panel;
}

// ── 分栏（column_set / column） ──────────────────────────────

export interface ColumnOptions {
  weight?: number;
  vertical_align?: string;
}

export function column(elements: Record<string, unknown>[], options?: ColumnOptions): Record<string, unknown> {
  return {
    tag: "column",
    width: "weighted",
    weight: options?.weight ?? 1,
    vertical_align: options?.vertical_align ?? "center",
    elements,
  };
}

export interface ColumnSetOptions {
  flex_mode?: string;
  background_style?: string;
}

export function columnSet(columns: Record<string, unknown>[], options?: ColumnSetOptions): Record<string, unknown> {
  return {
    tag: "column_set",
    flex_mode: options?.flex_mode ?? "none",
    background_style: options?.background_style ?? "default",
    columns,
  };
}

// ── 业务面板：Thinking ──────────────────────────────────────

interface ThinkingPanelOptions {
  thinking: string;
  reasoningElapsedMs?: number;
}

export function buildThinkingPanel(options: ThinkingPanelOptions): Record<string, unknown>[] {
  const truncatedThinking = options.thinking.length > THINKING_OVERFLOW_TRUNCATE
    ? truncateSafely(options.thinking, THINKING_OVERFLOW_TRUNCATE, "\n...")
    : options.thinking;

  const durLabel = options.reasoningElapsedMs
    ? ` ${formatReasoningDuration(options.reasoningElapsedMs)}`
    : "";

  return [
    collapsiblePanel({
      title: {
        tag: "markdown",
        content: `💭 Thought${durLabel}`,
        i18n_content: {
          zh_cn: `💭 思考${durLabel}`,
          en_us: `💭 Thought${durLabel}`,
        },
      },
      backgroundColor: "wathet",
      iconPosition: "follow_text",
      elements: [markdown(truncatedThinking, { text_size: "notation" })],
    }),
    hr(),
  ];
}

// ── 业务面板：工具结果 ──────────────────────────────────────

export interface ToolResultEntry {
  toolName: string;
  label: string;
  detail: string;
  resultPreview: string;
}

const EXT_LANG_MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  json: "json",
  yaml: "yaml", yml: "yaml",
  md: "markdown",
  html: "html", htm: "html",
  css: "css",
  sql: "sql",
  sh: "bash", bash: "bash", zsh: "bash",
  xml: "xml",
  toml: "toml",
  ini: "ini",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin", kts: "kotlin",
  dart: "dart",
  dockerfile: "dockerfile",
  makefile: "makefile",
  diff: "diff",
};

function detectLangFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG_MAP[ext] ?? "";
}

function formatToolContent(toolName: string, detail: string, result: string): string {
  if (toolName === "Read") {
    const lang = detectLangFromPath(detail);
    return "```" + lang + "\n" + result + "\n```";
  }
  if (toolName === "Bash") {
    return "```bash\n" + result + "\n```";
  }
  return result;
}

function buildToolResultPanel(entry: ToolResultEntry): Record<string, unknown> {
  const raw = entry.resultPreview.length > TOOL_RESULT_TRUNCATE
    ? truncateSafely(entry.resultPreview, TOOL_RESULT_TRUNCATE, "\n...")
    : entry.resultPreview;

  const content = formatToolContent(entry.toolName, entry.detail, raw);
  const headerTitle = entry.detail
    ? `**${entry.label}** \`${entry.detail}\``
    : entry.label;

  return collapsiblePanel({
    title: headerTitle,
    backgroundColor: "grey",
    elements: [markdown(content, { text_size: "notation" })],
  });
}

export function buildToolPanels(results: ToolResultEntry[]): Record<string, unknown>[] {
  if (results.length === 0) return [];
  return results.map(r => buildToolResultPanel(r));
}
