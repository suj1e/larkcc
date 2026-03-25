/**
 * 飞书文档块构建器
 */

import { BlockType, CalloutColors, LanguageMap, CalloutType, ColorNameMap, AlignType } from "./constants.js";

// ── 类型定义 ───────────────────────────────────────────────────

export interface TextElement {
  text_run?: { content: string };
  link?: { text_run: { content: string }; href: string };
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inline_code?: { content: string };
  text_color?: string;
  background_color?: string;
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
 * 解析颜色值
 * 支持颜色名称（red）和十六进制（#FF0000）
 */
function parseColorValue(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  // 十六进制颜色
  if (trimmed.startsWith("#")) {
    const hex = trimmed.toUpperCase();
    if (/^#[0-9A-F]{6}$/i.test(hex) || /^#[0-9A-F]{3}$/i.test(hex)) {
      return hex;
    }
    // 扩展 3 位十六进制到 6 位
    if (/^#[0-9A-F]{3}$/i.test(hex)) {
      return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toUpperCase();
    }
    return hex;
  }
  // 颜色名称
  return ColorNameMap[trimmed] || null;
}

/**
 * 解析 style 属性中的颜色
 * 支持：color:red, background-color:yellow, color:#FF0000
 */
function parseStyleColors(style: string): { textColor?: string; bgColor?: string } {
  const result: { textColor?: string; bgColor?: string } = {};

  // 匹配 color 和 background-color
  const colorMatch = style.match(/color\s*:\s*([^;]+)/i);
  const bgColorMatch = style.match(/background-color\s*:\s*([^;]+)/i);

  if (colorMatch) {
    const color = parseColorValue(colorMatch[1]);
    if (color) result.textColor = color;
    else console.warn(`⚠️ [format] 无效颜色值: "${colorMatch[1]}"，已忽略`);
  }

  if (bgColorMatch) {
    const color = parseColorValue(bgColorMatch[1]);
    if (color) result.bgColor = color;
    else console.warn(`⚠️ [format] 无效背景色值: "${bgColorMatch[1]}"，已忽略`);
  }

  return result;
}

/**
 * 解析内联 Markdown 和 HTML 格式
 * 支持：
 * - **bold**、*italic*、`code`、[link](url)、~~strikethrough~~
 * - <u>underline</u>
 * - <span style="color:red">colored text</span>
 * - <span style="background-color:yellow">highlighted text</span>
 * - \ 转义
 */
export function parseInlineText(text: string): TextElement[] {
  const elements: TextElement[] = [];
  let remaining = text;

  // 处理转义后的文本
  const unescape = (s: string) => s.replace(/\\([<>*_~`\[\]])/g, "$1");

  // 正则匹配各种内联格式
  const patterns = [
    // 转义字符 \* \_ \< 等 - 先匹配，避免被其他规则捕获
    { regex: /\\([<>*_~`\[\]])/, type: "escape" },
    // 下划线 <u>text</u>
    { regex: /<u>([^<]*)<\/u>/i, type: "underline" },
    // 带颜色的 span <span style="color:red">text</span>
    { regex: /<span\s+style\s*=\s*["']([^"']+)["']\s*>([^<]*)<\/span>/i, type: "span" },
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
          case "escape":
            element = { text_run: { content: match[1] } };
            break;
          case "underline":
            element = { text_run: { content: unescape(match[1]) }, underline: true };
            break;
          case "span":
            const colors = parseStyleColors(match[1]);
            const content = unescape(match[2]);
            element = { text_run: { content } };
            if (colors.textColor) element.text_color = colors.textColor;
            if (colors.bgColor) element.background_color = colors.bgColor;
            break;
          case "bold":
            element = { text_run: { content: unescape(match[1]) }, bold: true };
            break;
          case "italic":
            element = { text_run: { content: unescape(match[1] || match[2]) }, italic: true };
            break;
          case "code":
            element = { inline_code: { content: match[1] } };
            break;
          case "strikethrough":
            element = { text_run: { content: unescape(match[1]) }, strikethrough: true };
            break;
          case "link":
            element = { link: { text_run: { content: unescape(match[1]) }, href: match[2] } };
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
        elements.push({ text_run: { content: unescape(plainText) } });
      }
      elements.push(earliestMatch.element);
      remaining = remaining.slice(earliestMatch.index + earliestMatch.length);
    } else {
      // 没有匹配，全部作为普通文本
      if (remaining) {
        elements.push({ text_run: { content: unescape(remaining) } });
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

export interface CellMerge {
  colspan: number;
  rowspan: number;
}

export interface TableCell {
  content: string;
  align?: "left" | "center" | "right";
  merge?: CellMerge;
}

export interface TableData {
  rows: TableCell[][];
}

/**
 * 计算字符串显示宽度（中文算 2，英文算 1）
 */
function calculateTextWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    // CJK 字符范围
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * 构建表格单元格 Block
 */
function buildTableCell(cell: TableCell): Block {
  const alignMap = {
    left: AlignType.LEFT,
    center: AlignType.CENTER,
    right: AlignType.RIGHT,
  };

  const block: Block = {
    block_type: BlockType.TABLE_CELL,
    text: { elements: parseInlineText(cell.content.trim()) },
  };

  // 添加对齐属性
  if (cell.align && cell.align !== "left") {
    (block as any).property = { align: alignMap[cell.align] };
  }

  return block;
}

export function buildTableBlock(data: TableData): Block {
  const { rows } = data;
  if (rows.length === 0 || rows[0].length === 0) {
    return {
      block_type: BlockType.TABLE,
      table: {
        property: { row_size: 0, column_size: 0, column_width: [] },
        cells: [],
      },
    };
  }

  const rowSize = rows.length;
  const columnSize = rows[0].length;

  // 构建单元格和合并信息
  const cells: Block[] = [];
  const mergeInfo: Array<{ row_span: number; col_span: number; row_index: number; col_index: number }> = [];

  // 追踪被合并的单元格位置
  const mergedCells = new Set<string>();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    for (let colIndex = 0; colIndex < rows[rowIndex].length; colIndex++) {
      const cell = rows[rowIndex][colIndex];
      const key = `${rowIndex}-${colIndex}`;

      // 跳过被合并的单元格
      if (mergedCells.has(key)) continue;

      // 处理合并
      if (cell.merge && (cell.merge.colspan > 1 || cell.merge.rowspan > 1)) {
        const colspan = cell.merge.colspan || 1;
        const rowspan = cell.merge.rowspan || 1;

        mergeInfo.push({
          row_span: rowspan,
          col_span: colspan,
          row_index: rowIndex,
          col_index: colIndex,
        });

        // 标记被合并的单元格
        for (let r = rowIndex; r < rowIndex + rowspan && r < rows.length; r++) {
          for (let c = colIndex; c < colIndex + colspan && c < rows[r].length; c++) {
            if (r !== rowIndex || c !== colIndex) {
              mergedCells.add(`${r}-${c}`);
            }
          }
        }
      }

      cells.push(buildTableCell(cell));
    }
  }

  // 计算每列最大宽度
  const columnWidths: number[] = [];
  for (let colIndex = 0; colIndex < columnSize; colIndex++) {
    let maxWidth = 50; // 最小宽度
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      if (colIndex < rows[rowIndex].length) {
        const cell = rows[rowIndex][colIndex];
        const width = calculateTextWidth(cell.content);
        // 考虑合并单元格的宽度
        const colspan = cell.merge?.colspan || 1;
        if (colspan === 1) {
          maxWidth = Math.max(maxWidth, Math.min(width * 10 + 20, 300));
        }
      }
    }
    columnWidths.push(maxWidth);
  }

  const tableBlock: Block = {
    block_type: BlockType.TABLE,
    table: {
      property: {
        row_size: rowSize,
        column_size: columnSize,
        column_width: columnWidths,
      },
      cells,
    },
  };

  // 添加合并信息
  if (mergeInfo.length > 0) {
    (tableBlock.table as any).merge_info = mergeInfo;
  }

  return tableBlock;
}
