/**
 * 飞书文档块构建器
 */

import { BlockType, CalloutColors, LanguageMap, CalloutType } from "./constants.js";

// ── 类型定义 ───────────────────────────────────────────────────

export interface TextElement {
  text_run?: { content: string };
  link?: { text_run: { content: string }; href: string };
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inline_code?: { content: string };
}

export interface Block {
  block_type: number;
  text?: { elements: TextElement[] };
  heading1?: { elements: TextElement[] };
  heading2?: { elements: TextElement[] };
  heading3?: { elements: TextElement[] };
  heading4?: { elements: TextElement[] };
  heading5?: { elements: TextElement[] };
  heading6?: { elements: TextElement[] };
  heading7?: { elements: TextElement[] };
  heading8?: { elements: TextElement[] };
  heading9?: { elements: TextElement[] };
  bullet?: { elements: TextElement[] };
  ordered?: { elements: TextElement[] };
  code?: { style: { language: number; wrap: boolean }; elements: TextElement[] };
  quote?: { elements: TextElement[] };
  todo?: { style: { checked: boolean }; elements: TextElement[] };
  equation?: { content: string };
  callout?: { style: { background_color: string }; elements: TextElement[] };
  divider?: {};
  table?: {
    property: { row_size: number; column_size: number; column_width: number[] };
    cells: Block[];
  };
}

// ── 内联格式解析 ───────────────────────────────────────────────────

/**
 * 解析内联 Markdown 格式
 * 支持：**bold**、*italic*、`code`、[link](url)、~~strikethrough~~
 *
 * 已知限制：
 * - 不支持嵌套格式（如 **bold *italic* bold**）
 * - 不支持反斜杠转义（如 \*not italic\*）
 */
export function parseInlineText(text: string): TextElement[] {
  const elements: TextElement[] = [];
  let remaining = text;

  // 正则匹配各种内联格式
  const patterns = [
    // 粗体 **text**
    { regex: /\*\*([^*]+)\*\*/, type: "bold" },
    // 斜体 *text* 或 _text_
    { regex: /(?:\*([^*]+)\*|_([^_]+)_)/, type: "italic" },
    // 行内代码 `code`
    { regex: /`([^`]+)`/, type: "code" },
    // 删除线 ~~text~~
    { regex: /~~([^~]+)~~/, type: "strikethrough" },
    // 链接 [text](url)
    { regex: /\[([^\]]+)\]\(([^)]+)\)/, type: "link" },
  ];

  while (remaining.length > 0) {
    let earliestMatch: { index: number; length: number; element: TextElement } | null = null;

    for (const { regex, type } of patterns) {
      regex.lastIndex = 0;
      const match = regex.exec(remaining);
      if (match && (earliestMatch === null || match.index < earliestMatch.index)) {
        let element: TextElement;
        switch (type) {
          case "bold":
            element = { text_run: { content: match[1] }, bold: true };
            break;
          case "italic":
            element = { text_run: { content: match[1] || match[2] }, italic: true };
            break;
          case "code":
            element = { inline_code: { content: match[1] } };
            break;
          case "strikethrough":
            element = { text_run: { content: match[1] }, strikethrough: true };
            break;
          case "link":
            element = { link: { text_run: { content: match[1] }, href: match[2] } };
            break;
          default:
            continue;
        }
        earliestMatch = { index: match.index, length: match[0].length, element };
      }
    }

    if (earliestMatch && earliestMatch.index === 0) {
      elements.push(earliestMatch.element);
      remaining = remaining.slice(earliestMatch.length);
    } else if (earliestMatch) {
      // 匹配前有普通文本
      const plainText = remaining.slice(0, earliestMatch.index);
      if (plainText) {
        elements.push({ text_run: { content: plainText } });
      }
      elements.push(earliestMatch.element);
      remaining = remaining.slice(earliestMatch.index + earliestMatch.length);
    } else {
      // 没有匹配，全部作为普通文本
      if (remaining) {
        elements.push({ text_run: { content: remaining } });
      }
      break;
    }
  }

  return elements;
}

// ── 块构建函数 ───────────────────────────────────────────────────

export function buildTextBlock(content: string): Block {
  return {
    block_type: BlockType.TEXT,
    text: { elements: parseInlineText(content) },
  };
}

export function buildHeadingBlock(level: number, content: string): Block {
  const blockTypes = [
    BlockType.HEADING1, BlockType.HEADING2, BlockType.HEADING3,
    BlockType.HEADING4, BlockType.HEADING5, BlockType.HEADING6,
    BlockType.HEADING7, BlockType.HEADING8, BlockType.HEADING9,
  ];
  const properties = ["heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "heading7", "heading8", "heading9"];

  const index = Math.min(level - 1, 8);
  return {
    block_type: blockTypes[index],
    [properties[index]]: { elements: parseInlineText(content) },
  } as Block;
}

export function buildCodeBlock(code: string, lang: string = ""): Block {
  const langId = LanguageMap[lang.toLowerCase()] ?? 1;
  return {
    block_type: BlockType.CODE,
    code: {
      style: { language: langId, wrap: true },
      elements: [{ text_run: { content: code } }],
    },
  };
}

export function buildBulletBlock(content: string): Block {
  return {
    block_type: BlockType.BULLET,
    bullet: { elements: parseInlineText(content) },
  };
}

export function buildOrderedBlock(content: string): Block {
  return {
    block_type: BlockType.ORDERED,
    ordered: { elements: parseInlineText(content) },
  };
}

export function buildQuoteBlock(content: string): Block {
  return {
    block_type: BlockType.QUOTE,
    quote: { elements: parseInlineText(content) },
  };
}

export function buildTodoBlock(content: string, checked: boolean): Block {
  return {
    block_type: BlockType.TODO,
    todo: {
      style: { checked },
      elements: parseInlineText(content),
    },
  };
}

export function buildEquationBlock(latex: string): Block {
  return {
    block_type: BlockType.EQUATION,
    equation: { content: latex },
  };
}

export function buildCalloutBlock(type: CalloutType, content: string): Block {
  const color = CalloutColors[type] || CalloutColors.NOTE;
  return {
    block_type: BlockType.CALLOUT,
    callout: {
      style: { background_color: color },
      elements: parseInlineText(content),
    },
  };
}

export function buildDividerBlock(): Block {
  return {
    block_type: BlockType.DIVIDER,
    divider: {},
  };
}

// ── 表格构建 ───────────────────────────────────────────────────

export interface TableData {
  rows: string[][];
  alignments: ("left" | "center" | "right")[];
}

export function buildTableBlock(data: TableData): Block {
  // TODO: 飞书表格 API 暂不支持列级对齐，alignments 预留供未来使用
  const { rows, alignments } = data;
  const columnSize = rows[0]?.length || 0;
  const rowSize = rows.length;

  // 构建单元格
  const cells: Block[] = [];
  for (const row of rows) {
    for (const cell of row) {
      cells.push({
        block_type: BlockType.TABLE_CELL,
        text: { elements: parseInlineText(cell.trim()) },
      } as Block);
    }
  }

  // 默认列宽
  const columnWidth = new Array(columnSize).fill(100);

  return {
    block_type: BlockType.TABLE,
    table: {
      property: {
        row_size: rowSize,
        column_size: columnSize,
        column_width: columnWidth,
      },
      cells,
    },
  };
}
