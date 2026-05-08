/**
 * 时间格式化 & 折叠面板构建
 *
 * 统一 CardKit 和 Update 模式的 thinking / tool 折叠面板，
 * 对齐飞书卡片 JSON v2 collapsible_panel 规范。
 */

import { truncateSafely } from "./card-optimize.js";

// ── 常量 ──────────────────────────────────────────────────

/** Thinking 内容截断阈值（字符数） */
export const THINKING_OVERFLOW_TRUNCATE = 3000;

/** 工具结果截断阈值（字符数） */
export const TOOL_RESULT_TRUNCATE = 500;

// ── 时间格式化 ─────────────────────────────────────────────

/** 秒 → "3.2s" / "1m 23s" */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = Math.round(seconds % 60);
  return `${minutes}m ${remainSec}s`;
}

/** 毫秒 → "3.2s" / "1m 23s" */
export function formatReasoningDuration(ms: number): string {
  return formatDuration(ms / 1000);
}

// ── Thinking 折叠面板 ─────────────────────────────────────

interface ThinkingPanelOptions {
  thinking: string;
  reasoningElapsedMs?: number;
}

/**
 * 构建 thinking 折叠面板元素（collapsible_panel）
 *
 * 返回 [collapsible_panel, hr]，可直接展开到卡片 elements 数组。
 * CardKit 和 Update 模式共用此函数，避免重复。
 */
export function buildThinkingPanel(options: ThinkingPanelOptions): any[] {
  const truncatedThinking = options.thinking.length > THINKING_OVERFLOW_TRUNCATE
    ? truncateSafely(options.thinking, THINKING_OVERFLOW_TRUNCATE, "\n...")
    : options.thinking;

  const durLabel = options.reasoningElapsedMs
    ? ` ${formatReasoningDuration(options.reasoningElapsedMs)}`
    : "";

  return [
    {
      tag: "collapsible_panel",
      expanded: false,
      background_color: "wathet",
      header: {
        title: {
          tag: "markdown",
          content: `💭 Thought${durLabel}`,
          i18n_content: {
            zh_cn: `💭 思考${durLabel}`,
            en_us: `💭 Thought${durLabel}`,
          },
        },
        vertical_align: "center",
        icon: {
          tag: "standard_icon",
          token: "down-small-ccm_outlined",
          size: "16px 16px",
        },
        icon_position: "follow_text",
        icon_expanded_angle: -180,
      },
      border: { color: "grey", corner_radius: "5px" },
      vertical_spacing: "8px",
      padding: "8px 8px 8px 8px",
      elements: [
        {
          tag: "markdown",
          content: truncatedThinking,
          text_size: "notation",
        },
      ],
    },
    { tag: "hr" },
  ];
}

// ── 工具结果折叠面板 ─────────────────────────────────────

export interface ToolResultEntry {
  label: string;
  detail: string;
  resultPreview: string;
}

function buildToolResultPanel(entry: ToolResultEntry): any {
  const preview = entry.resultPreview.length > TOOL_RESULT_TRUNCATE
    ? truncateSafely(entry.resultPreview, TOOL_RESULT_TRUNCATE, "\n...")
    : entry.resultPreview;

  const headerTitle = entry.detail
    ? `${entry.label} — ${entry.detail}`
    : entry.label;

  return {
    tag: "collapsible_panel",
    expanded: false,
    background_color: "grey",
    header: {
      title: {
        tag: "plain_text",
        content: headerTitle,
      },
      vertical_align: "center",
      icon: {
        tag: "standard_icon",
        token: "down-small-ccm_outlined",
        size: "16px 16px",
      },
      icon_position: "right",
      icon_expanded_angle: -180,
    },
    border: { color: "grey", corner_radius: "5px" },
    vertical_spacing: "8px",
    padding: "8px 8px 8px 8px",
    elements: [
      {
        tag: "markdown",
        content: preview,
        text_size: "notation",
      },
    ],
  };
}

export function buildToolPanels(results: ToolResultEntry[]): any[] {
  if (results.length === 0) return [];
  return results.map(r => buildToolResultPanel(r));
}
