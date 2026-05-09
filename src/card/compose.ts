/**
 * 飞书卡片 JSON v2 — 整卡构建器
 *
 * buildCard: 通用卡片骨架
 * buildSimpleCard / buildStatusCard / buildMarkdownCard: 业务级便利函数
 */

import { markdown, hr } from "./elements.js";
import { buildThinkingPanel } from "./containers.js";
import { buildHeader, buildStatsTags } from "./header.js";
import { buildFooterElement } from "./footer.js";
import { formatWarnings } from "../format/sanitize.js";

// ── 通用卡片骨架 ──────────────────────────────────────────

export interface BuildCardOptions {
  elements: Record<string, unknown>[];
  header?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export function buildCard(options: BuildCardOptions): Record<string, unknown> {
  const card: Record<string, unknown> = {
    schema: "2.0",
    body: { elements: options.elements },
  };
  if (options.config) card.config = options.config;
  if (options.header) card.header = options.header;
  return card;
}

// ── 简单卡片（无 header） ──────────────────────────────────

export function buildSimpleCard(markdownContent: string, warnings: string[] = []): Record<string, unknown> {
  let content = markdownContent;
  if (warnings.length > 0) {
    content += formatWarnings(warnings);
  }
  return buildCard({ elements: [markdown(content)] });
}

// ── 状态通知卡片 ──────────────────────────────────────────

export function buildStatusCard(options: {
  title?: string;
  bodyLines: string[];
  template?: string;
  tags?: Array<{ text: string; color: string }>;
  footer?: string;
}): Record<string, unknown> {
  const header = buildHeader({
    title: options.title ?? "larkcc",
    template: options.template ?? "blue",
    tags: options.tags,
  });

  const elements: Record<string, unknown>[] = [
    markdown(options.bodyLines.join("\n")),
  ];

  if (options.footer) {
    elements.push(hr());
    elements.push(markdown(`<font color='grey'>${options.footer}</font>`, { text_size: "notation" }));
  }

  return buildCard({ elements, header, config: { wide_screen_mode: true } });
}

// ── Markdown 卡片（支持 thinking） ──────────────────────────

export interface CardBuildOptions {
  thinking?: string;
  thinkingInProgress?: boolean;
  reasoningElapsedMs?: number;
  cardTitle?: string;
}

export function buildMarkdownCard(
  markdownContent: string,
  warnings: string[] = [],
  options?: CardBuildOptions,
): Record<string, unknown> {
  let content = markdownContent;
  if (warnings.length > 0) {
    content += formatWarnings(warnings);
  }

  const elements: Record<string, unknown>[] = [];

  if (options?.thinkingInProgress) {
    elements.push(markdown("💭 思考中..."));
  } else if (options?.thinking) {
    elements.push(...buildThinkingPanel({
      thinking: options.thinking,
      reasoningElapsedMs: options.reasoningElapsedMs,
    }));
  }

  elements.push(markdown(content));

  const card = buildCard({
    elements,
    config: { wide_screen_mode: true },
  });

  if (options?.cardTitle) {
    card.header = {
      title: { tag: "plain_text", content: options.cardTitle },
      template: "blue",
    };
  }

  return card;
}
