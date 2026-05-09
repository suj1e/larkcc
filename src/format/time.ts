/**
 * 时间格式化
 *
 * 截断常量已迁移：
 * - THINKING_OVERFLOW_TRUNCATE / TOOL_RESULT_TRUNCATE / TASK_SUMMARY_TRUNCATE → ../card/constants.ts
 * - STREAMING_TRUNCATE → ../streaming/flush-controller.ts
 */

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
