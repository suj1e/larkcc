/**
 * 飞书卡片组件库 — barrel re-export
 */

// 原子展示组件
export { markdown, hr, plainText, textTag, standardIcon, customIcon } from "./elements.js";
export type { MarkdownOptions } from "./elements.js";

// 容器组件
export { collapsiblePanel, column, columnSet, buildThinkingPanel, buildToolPanels } from "./containers.js";
export type { CollapsiblePanelOptions, ToolResultEntry } from "./containers.js";

// Truncation constants (in containers.ts)
export { THINKING_OVERFLOW_TRUNCATE, TOOL_RESULT_TRUNCATE, TASK_SUMMARY_TRUNCATE } from "./containers.js";

// Header
export { buildHeader, buildStatsTags } from "./header.js";
export type { HeaderOptions, StatsInfo } from "./header.js";

// Footer
export { buildFooterElement } from "./footer.js";
export type { FooterStats } from "./footer.js";

// 整卡构建
export { buildCard, buildSimpleCard, buildStatusCard, buildMarkdownCard } from "./compose.js";
export type { BuildCardOptions, CardBuildOptions } from "./compose.js";

// 任务面板卡片
export { buildTaskPanelCard } from "./task-panel.js";
export type { TaskPanelStatus, TaskPanelCardOptions } from "./task-panel.js";
