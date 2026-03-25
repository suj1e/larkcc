/**
 * 飞书文档处理模块
 * 将 Markdown 转换为飞书文档块
 */

import { Block } from "./builder.js";
import {
  buildTextBlock,
  buildHeadingBlock,
  buildCodeBlock,
  buildBulletBlock,
  buildOrderedBlock,
  buildQuoteBlock,
  buildTodoBlock,
  buildEquationBlock,
  buildCalloutBlock,
  buildDividerBlock,
  buildTableBlock,
  parseInlineText,
} from "./builder.js";
import {
  parseTable,
  parseTodo,
  parseBlockEquation,
  parseCallout,
  parseHeading,
  isCodeBlockStart,
  isCodeBlockEnd,
  isDivider,
  isBulletList,
  isOrderedList,
} from "./parser.js";
import { sanitizeContent } from "./sanitize.js";
import { BlockType } from "./constants.js";

// ── 文档元数据 ───────────────────────────────────────────────────

export interface DocumentMeta {
  cwd: string;
  sessionId: string;
  profile: string;
  datetime: string;
}

// ── 主转换函数 ───────────────────────────────────────────────────

/**
 * 将 Markdown 文本转换为飞书文档块
 */
export function markdownToBlocks(
  markdown: string,
  originalMessage: string,
  meta: DocumentMeta
): { blocks: Block[]; warnings: string[] } {
  const blocks: Block[] = [];

  // 1. 内容清理
  const { content: sanitizedMarkdown, warnings } = sanitizeContent(markdown);
  if (warnings.length > 0) {
    console.error(`[WARN] Content sanitization: ${warnings.join(", ")}`);
  }

  // 2. 按行处理
  const lines = sanitizedMarkdown.split("\n");
  let currentPara: string[] = [];
  let inCodeBlock = false;
  let codeContent: string[] = [];
  let codeLang = "";

  const flushPara = () => {
    if (currentPara.length > 0) {
      const content = currentPara.join("\n").trim();
      if (content) {
        blocks.push(buildTextBlock(content));
      }
      currentPara = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // --- 代码块处理 ---
    if (inCodeBlock) {
      if (isCodeBlockEnd(line)) {
        blocks.push(buildCodeBlock(codeContent.join("\n"), codeLang));
        inCodeBlock = false;
        codeContent = [];
        codeLang = "";
      } else {
        codeContent.push(line);
      }
      continue;
    }

    const codeStart = isCodeBlockStart(line);
    if (codeStart.isStart) {
      flushPara();
      inCodeBlock = true;
      codeLang = codeStart.lang;
      codeContent = [];
      continue;
    }

    // --- 块级公式 ---
    const equationResult = parseBlockEquation(lines, i);
    if (equationResult) {
      flushPara();
      blocks.push(buildEquationBlock(equationResult.result.latex));
      i = equationResult.endIndex;
      continue;
    }

    // --- 高亮块 ---
    const calloutResult = parseCallout(lines, i);
    if (calloutResult) {
      flushPara();
      const { type, content } = calloutResult.result;
      blocks.push(buildCalloutBlock(type, content.join("\n")));
      i = calloutResult.endIndex;
      continue;
    }

    // --- 表格 ---
    const tableResult = parseTable(lines, i);
    if (tableResult) {
      flushPara();
      blocks.push(buildTableBlock(tableResult.data));
      i = tableResult.endIndex;
      continue;
    }

    // --- 任务列表 ---
    const todoResult = parseTodo(line);
    if (todoResult) {
      flushPara();
      blocks.push(buildTodoBlock(todoResult.content, todoResult.checked));
      continue;
    }

    // --- 标题 ---
    const headingLevel = parseHeading(line);
    if (headingLevel > 0) {
      flushPara();
      const content = line.slice(headingLevel + 1).trim();
      blocks.push(buildHeadingBlock(headingLevel, content));
      continue;
    }

    // --- 分割线 ---
    if (isDivider(line)) {
      flushPara();
      blocks.push(buildDividerBlock());
      continue;
    }

    // --- 引用块 ---
    if (line.trim().startsWith("> ")) {
      flushPara();
      const quoteContent = line.trim().slice(2);
      // 检查是否是高亮块语法（已在上面处理）
      if (!quoteContent.match(/^\[!\w+\]/)) {
        blocks.push(buildQuoteBlock(quoteContent));
      }
      continue;
    }

    // --- 无序列表 ---
    if (isBulletList(line)) {
      flushPara();
      const match = line.match(/^(\s*)[-*]\s+(.+)$/);
      if (match) {
        blocks.push(buildBulletBlock(match[2]));
      }
      continue;
    }

    // --- 有序列表 ---
    if (isOrderedList(line)) {
      flushPara();
      const match = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
      if (match) {
        blocks.push(buildOrderedBlock(match[3]));
      }
      continue;
    }

    // --- 普通段落 ---
    currentPara.push(line);
  }

  // 处理剩余段落
  flushPara();

  // 3. 添加元数据头部
  const headerBlocks = buildDocumentHeader(originalMessage, meta);

  return { blocks: [...headerBlocks, ...blocks], warnings };
}

// ── 文档头部构建 ───────────────────────────────────────────────────

function buildDocumentHeader(originalMessage: string, meta: DocumentMeta): Block[] {
  const blocks: Block[] = [];

  // 引用块显示用户原始消息
  if (originalMessage) {
    blocks.push({
      block_type: BlockType.QUOTE,
      quote: { elements: parseInlineText(originalMessage) },
    });
  }

  // 分割线
  blocks.push(buildDividerBlock());

  // 元数据
  const metaText = `📁 工作目录: ${meta.cwd}\n🤖 机器人: ${meta.profile}\n🔗 会话ID: ${meta.sessionId}\n📅 时间: ${meta.datetime}`;
  blocks.push({
    block_type: BlockType.TEXT,
    text: { elements: parseInlineText(metaText) },
  });

  // 分割线
  blocks.push(buildDividerBlock());

  return blocks;
}
