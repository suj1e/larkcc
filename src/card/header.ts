/**
 * 飞书卡片 JSON v2 — Header 构建器
 */

import { plainText, textTag, standardIcon, customIcon } from "./elements.js";
import { formatDuration } from "../format/time.js";

// ── Header ──────────────────────────────────────────────────

const DEFAULT_ICON_TOKEN = "larkcommunity_colorful";

export interface HeaderOptions {
  title: string;
  subtitle?: string;
  template?: string;
  iconImgKey?: string;
  iconToken?: string;
  tags?: Array<{ text: string; color: string }>;
}

export function buildHeader(options: HeaderOptions): Record<string, unknown> {
  const header: Record<string, unknown> = {
    title: plainText(options.title),
    template: options.template ?? "blue",
  };

  if (options.subtitle) {
    header.subtitle = plainText(options.subtitle);
  }

  if (options.iconImgKey) {
    header.icon = customIcon(options.iconImgKey);
  } else {
    header.icon = standardIcon(options.iconToken ?? DEFAULT_ICON_TOKEN);
  }

  if (options.tags?.length) {
    header.text_tag_list = options.tags.slice(0, 3).map(t => textTag(t.text, t.color));
  }

  return header;
}

// ── Stats Tags ──────────────────────────────────────────────

export interface StatsInfo {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  duration?: number;
}

export function buildStatsTags(stats: StatsInfo): Array<{ text: string; color: string }> {
  const tags: Array<{ text: string; color: string }> = [];
  if (stats.model) tags.push({ text: stats.model, color: "blue" });
  const totalTokens = (stats.inputTokens ?? 0) + (stats.outputTokens ?? 0);
  if (totalTokens > 0) tags.push({ text: `${totalTokens.toLocaleString()} tokens`, color: "turquoise" });
  if (stats.duration != null) tags.push({ text: formatDuration(stats.duration), color: "orange" });
  return tags;
}
