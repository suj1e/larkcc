/**
 * 时间格式化 & Thinking 卡片元素构建
 *
 * 统一 CardKit 和 Update 模式的 thinking 折叠面板，
 * 对齐 openclaw-lark 的 collapsible_panel 方案。
 */

import { truncateSafely } from "./card-optimize.js";

// ── 常量 ──────────────────────────────────────────────────

/** Thinking 内容截断阈值（字符数） */
export const THINKING_OVERFLOW_TRUNCATE = 3000;

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
      background_style: "wathet",
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
