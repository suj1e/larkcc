/**
 * 飞书卡片 JSON v2 — Footer 构建器
 */

import { markdown } from "./elements.js";
import { column, columnSet } from "./containers.js";

// ── Footer ──────────────────────────────────────────────────

export interface FooterStats {
  inputTokens?: number;
  outputTokens?: number;
  toolCount?: number;
}

export function buildFooterElement(stats: FooterStats): Record<string, unknown> | null {
  const columns: Record<string, unknown>[] = [];

  if (stats.inputTokens != null) {
    columns.push(column([
      markdown(`<font color='grey'>📥 ${stats.inputTokens.toLocaleString()}</font>`, { text_size: "notation" }),
    ]));
  }
  if (stats.outputTokens != null) {
    columns.push(column([
      markdown(`<font color='grey'>📤 ${stats.outputTokens.toLocaleString()}</font>`, { text_size: "notation" }),
    ]));
  }
  if (stats.toolCount != null && stats.toolCount > 0) {
    columns.push(column([
      markdown(`<font color='grey'>🔧 ${stats.toolCount}</font>`, { text_size: "notation" }),
    ]));
  }

  if (columns.length === 0) return null;

  return columnSet(columns);
}
