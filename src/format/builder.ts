/**
 * 飞书文档块构建器
 *
 * 所有数据结构严格对齐 @larksuiteoapi/node-sdk 类型定义
 */

import {
  BlockType, CalloutColorMap, CalloutType, LanguageMap,
  FontColorNameMap, FontBgColorNameMap, FontColor, FontBgColor,
} from "./constants.js";

// ── 类型定义 ───────────────────────────────────────────────────

/**
 * text_element_style（对齐 SDK）
 * 样式属性嵌套在 text_run 内部
 */
export interface TextElementStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inline_code?: boolean;
  text_color?: number;
  background_color?: number;
  link?: { url: string };
}

/**
 * TextElement（对齐 SDK）
 * 只有一个可选的 text_run 属性，样式在 text_run.text_element_style 内
 */
export interface TextElement {
  text_run?: {
    content: string;
    text_element_style?: TextElementStyle;
  };
}

/**
 * 普通文档块（用于 children API 直接写入）
 */
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
  todo?: { style: { done?: boolean }; elements: TextElement[] };
  equation?: { elements: Array<{ equation: { content: string } }> };
  divider?: {};
}

// ── Descendants API 类型（用于表格、高亮块） ────────────────────────

/**
 * 高亮块 Descendants 结构
 * callout 是容器块，内容通过子块实现
 */
export interface CalloutDescendants {
  calloutBlock: {
    block_type: 19;
    block_id: string;
    children: string[];
    callout: {
      background_color: number;
      border_color: number;
    };
  };
  contentDescendants: Array<{
    block_type: 2;
    block_id: string;
    text: { elements: TextElement[] };
  }>;
}

/**
 * 表格 Descendants 结构
 * table.cells 是 block ID 引用，table_cell 是空壳容器，内容通过子块实现
 */
export interface TableDescendants {
  tableBlock: {
    block_type: 31;
    block_id: string;
    children: string[];
    table: {
      property: {
        row_size: number;
        column_size: number;
        column_width: number[];
        merge_info?: Array<{ row_span?: number; col_span?: number }>;
      };
      cells: string[];
    };
  };
  cellDescendants: Array<
    | { block_type: 32; block_id: string; children: string[]; table_cell: {} }
    | { block_type: 2; block_id: string; text: { elements: TextElement[] } }
  >;
}

/**
 * 文档块统一条目
 * 保持原始顺序，区分简单块和需要 Descendants API 的复杂块
 */
export type DocumentBlockItem =
  | { type: "simple"; block: Block }
  | { type: "table"; data: TableDescendants }
  | { type: "callout"; data: CalloutDescendants };

// ── 颜色映射 ───────────────────────────────────────────────────

/**
 * RGB 转 HSL 色相值（0-360）
 */
function rgbToHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return 0; // 灰色，无色相

  const d = max - min;
  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }
  return h * 360;
}

/**
 * 将 Hex 颜色值近似匹配到飞书 FontColor 枚举
 * 通过 HSL 色相区间分配到最近的 7 种颜色
 */
function hexToFontColor(hex: string): number {
  try {
    let h = hex.replace("#", "");
    // 扩展 3 位 hex 到 6 位
    if (h.length === 3) h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    if (h.length !== 6) return FontColor.GRAY;

    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const hue = rgbToHue(r, g, b);

    // 检查是否接近灰色（低饱和度）
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / (1 - Math.abs(2 * ((max + min) / 2) - 1));
    if (saturation < 0.15) return FontColor.GRAY;

    // 按色相区间分配
    if (hue < 15 || hue >= 345) return FontColor.PINK;   // Pink/Red
    if (hue < 45)  return FontColor.ORANGE;               // Orange
    if (hue < 75)  return FontColor.YELLOW;               // Yellow
    if (hue < 165) return FontColor.GREEN;                // Green
    if (hue < 255) return FontColor.BLUE;                 // Blue
    if (hue < 285) return FontColor.PURPLE;               // Purple
    return FontColor.GRAY;
  } catch {
    return FontColor.GRAY;
  }
}

/**
 * 将 Hex 颜色值近似匹配到飞书 FontBgColor 枚举
 * 通过明度区分 light (1-7) 和 dark (8-14) 变体
 */
function hexToFontBgColor(hex: string): number {
  try {
    let h = hex.replace("#", "");
    if (h.length === 3) h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    if (h.length !== 6) return FontBgColor.LIGHT_GRAY;

    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;

    const hue = rgbToHue(r, g, b);
    const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
    const isDark = lightness < 0.5;

    // 按色相 + 明度分配
    if (hue < 15 || hue >= 345) return isDark ? FontBgColor.DARK_PINK : FontBgColor.LIGHT_PINK;
    if (hue < 45)  return isDark ? FontBgColor.DARK_ORANGE : FontBgColor.LIGHT_ORANGE;
    if (hue < 75)  return isDark ? FontBgColor.DARK_YELLOW : FontBgColor.LIGHT_YELLOW;
    if (hue < 165) return isDark ? FontBgColor.DARK_GREEN : FontBgColor.LIGHT_GREEN;
    if (hue < 255) return isDark ? FontBgColor.DARK_BLUE : FontBgColor.LIGHT_BLUE;
    if (hue < 285) return isDark ? FontBgColor.DARK_PURPLE : FontBgColor.LIGHT_PURPLE;
    return isDark ? FontBgColor.DARK_GRAY : FontBgColor.LIGHT_GRAY;
  } catch {
    return FontBgColor.LIGHT_GRAY;
  }
}

/**
 * 解析 CSS 颜色值为飞书 FontColor 数字枚举
 * 支持颜色名（red）和 Hex（#FF0000）
 */
function parseCssToFontColor(value: string): number | undefined {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("#")) {
    return hexToFontColor(trimmed);
  }
  return FontColorNameMap[trimmed];
}

/**
 * 解析 CSS 颜色值为飞书 FontBgColor 数字枚举
 * 支持颜色名（lightgreen）和 Hex（#90EE90）
 */
function parseCssToFontBgColor(value: string): number | undefined {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("#")) {
    return hexToFontBgColor(trimmed);
  }
  return FontBgColorNameMap[trimmed];
}

/**
 * 解析 style 属性中的颜色
 * 支持：color:red, background-color:yellow, color:#FF0000
 * 返回飞书数字枚举值
 */
function parseStyleColors(style: string): { textColor?: number; bgColor?: number } {
  const result: { textColor?: number; bgColor?: number } = {};

  const colorMatch = style.match(/color\s*:\s*([^;]+)/i);
  const bgColorMatch = style.match(/background-color\s*:\s*([^;]+)/i);

  if (colorMatch) {
    const color = parseCssToFontColor(colorMatch[1]);
    if (color) result.textColor = color;
    else console.warn(`⚠️ [format] 无法映射颜色值: "${colorMatch[1]}"`);
  }

  if (bgColorMatch) {
    const color = parseCssToFontBgColor(bgColorMatch[1]);
    if (color) result.bgColor = color;
    else console.warn(`⚠️ [format] 无法映射背景色值: "${bgColorMatch[1]}"`);
  }

  return result;
}

// ── 内联格式解析 ───────────────────────────────────────────────────

/**
 * 解析内联 Markdown 和 HTML 格式
 *
 * 输出严格对齐飞书 SDK 的 TextElement 结构：
 * - 所有样式属性放在 text_run.text_element_style 内
 * - 链接通过 text_element_style.link 实现
 * - 行内代码通过 text_element_style.inline_code 布尔值实现
 * - 颜色为数字枚举值
 */
export function parseInlineText(text: string): TextElement[] {
  const elements: TextElement[] = [];
  let remaining = text;

  const unescape = (s: string) => s.replace(/\\([<>*_~`\[\]])/g, "$1");

  const patterns = [
    { regex: /\\([<>*_~`\[\]])/, type: "escape" },
    { regex: /<u>([^<]*)<\/u>/i, type: "underline" },
    { regex: /<span\s+style\s*=\s*["']([^"']+)["']\s*>([^<]*)<\/span>/i, type: "span" },
    { regex: /\*\*([^*]+)\*\*/, type: "bold" },
    { regex: /(?:\*([^*]+)\*|_([^_]+)_)/, type: "italic" },
    { regex: /`([^`]+)`/, type: "code" },
    { regex: /~~([^~]+)~~/, type: "strikethrough" },
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
            element = { text_run: { content: unescape(match[1]), text_element_style: { underline: true } } };
            break;
          case "span": {
            const colors = parseStyleColors(match[1]);
            const style: TextElementStyle = {};
            if (colors.textColor) style.text_color = colors.textColor;
            if (colors.bgColor) style.background_color = colors.bgColor;
            element = { text_run: { content: unescape(match[2]), text_element_style: Object.keys(style).length > 0 ? style : undefined } };
            break;
          }
          case "bold":
            element = { text_run: { content: unescape(match[1]), text_element_style: { bold: true } } };
            break;
          case "italic":
            element = { text_run: { content: unescape(match[1] || match[2]), text_element_style: { italic: true } } };
            break;
          case "code":
            element = { text_run: { content: unescape(match[1]), text_element_style: { inline_code: true } } };
            break;
          case "strikethrough":
            element = { text_run: { content: unescape(match[1]), text_element_style: { strikethrough: true } } };
            break;
          case "link":
            element = { text_run: { content: unescape(match[1]), text_element_style: { link: { url: match[2] } } } };
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
      const plainText = remaining.slice(0, earliestMatch.index);
      if (plainText) {
        elements.push({ text_run: { content: unescape(plainText) } });
      }
      elements.push(earliestMatch.element);
      remaining = remaining.slice(earliestMatch.index + earliestMatch.length);
    } else {
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
  const properties = ["heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "heading7", "heading8", "heading9"] as const;

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
      style: { done: checked },
      elements: parseInlineText(content),
    },
  };
}

export function buildEquationBlock(latex: string): Block {
  return {
    block_type: BlockType.EQUATION,
    equation: {
      elements: [{ equation: { content: latex } }],
    },
  };
}

/**
 * 构建高亮块（Descendants API）
 * callout 是容器块，没有 elements，内容通过子块实现
 */
export function buildCalloutBlock(type: CalloutType, content: string): CalloutDescendants {
  const { bg, border } = CalloutColorMap[type];
  const calloutId = crypto.randomUUID();

  // 内容按行拆分为多个 TEXT 子块
  const lines = content.split("\n");
  const textIds = lines.map((_, i) => `${calloutId}-text-${i}`);
  const textBlocks = lines.map((line, i) => ({
    block_type: BlockType.TEXT,
    block_id: textIds[i],
    text: { elements: parseInlineText(line) },
  }));

  return {
    calloutBlock: {
      block_type: BlockType.CALLOUT,
      block_id: calloutId,
      children: textIds,
      callout: { background_color: bg, border_color: border },
    },
    contentDescendants: textBlocks,
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
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * 构建表格 Descendants 结构
 *
 * 表格创建流程：
 * 1. table.cells 是 string[]（block ID 引用），不是 Block 对象
 * 2. table_cell 是空壳容器 {}，内容通过子块实现
 * 3. 使用 Descendants API 一次性创建表格 + 单元格 + 单元格内容
 */
export function buildTableBlock(data: TableData): TableDescendants {
  const { rows } = data;
  const tableId = crypto.randomUUID();

  if (rows.length === 0 || rows[0].length === 0) {
    return {
      tableBlock: {
        block_type: BlockType.TABLE,
        block_id: tableId,
        children: [],
        table: {
          property: { row_size: 0, column_size: 0, column_width: [] },
          cells: [],
        },
      },
      cellDescendants: [],
    };
  }

  const rowSize = rows.length;
  const columnSize = rows[0].length;
  const mergeInfo: Array<{ row_span: number; col_span: number }> = [];

  // 追踪被合并的单元格位置
  const mergedCells = new Set<string>();

  // 生成所有单元格的 descendants
  const cellDescendants: TableDescendants["cellDescendants"] = [];
  const cellIds: string[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    for (let colIndex = 0; colIndex < rows[rowIndex].length; colIndex++) {
      const cell = rows[rowIndex][colIndex];
      const key = `${rowIndex}-${colIndex}`;

      // 跳过被合并的单元格（仍然占位在 cells[] 中）
      if (mergedCells.has(key)) {
        cellIds.push(`${tableId}-cell-${rowIndex}-${colIndex}`);
        // 被合并的单元格仍然需要创建 table_cell（占位）
        cellDescendants.push({
          block_type: BlockType.TABLE_CELL,
          block_id: `${tableId}-cell-${rowIndex}-${colIndex}`,
          children: [],
          table_cell: {},
        });
        continue;
      }

      const cellId = `${tableId}-cell-${rowIndex}-${colIndex}`;
      const textId = `${cellId}-txt`;
      cellIds.push(cellId);

      // 处理合并
      if (cell.merge && (cell.merge.colspan > 1 || cell.merge.rowspan > 1)) {
        mergeInfo.push({
          row_span: cell.merge.rowspan || 1,
          col_span: cell.merge.colspan || 1,
        });

        // 标记被合并的单元格
        for (let r = rowIndex; r < rowIndex + (cell.merge.rowspan || 1) && r < rows.length; r++) {
          for (let c = colIndex; c < colIndex + (cell.merge.colspan || 1) && c < rows[r].length; c++) {
            if (r !== rowIndex || c !== colIndex) {
              mergedCells.add(`${r}-${c}`);
            }
          }
        }
      }

      // table_cell 容器
      cellDescendants.push({
        block_type: BlockType.TABLE_CELL,
        block_id: cellId,
        children: [textId],
        table_cell: {},
      });

      // 单元格文本内容
      cellDescendants.push({
        block_type: BlockType.TEXT,
        block_id: textId,
        text: { elements: parseInlineText(cell.content.trim()) },
      });
    }
  }

  // 计算每列最大宽度
  const columnWidths: number[] = [];
  for (let colIndex = 0; colIndex < columnSize; colIndex++) {
    let maxWidth = 50;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      if (colIndex < rows[rowIndex].length) {
        const cell = rows[rowIndex][colIndex];
        const width = calculateTextWidth(cell.content);
        const colspan = cell.merge?.colspan || 1;
        if (colspan === 1) {
          maxWidth = Math.max(maxWidth, Math.min(width * 10 + 20, 300));
        }
      }
    }
    columnWidths.push(maxWidth);
  }

  return {
    tableBlock: {
      block_type: BlockType.TABLE,
      block_id: tableId,
      children: cellIds,
      table: {
        property: {
          row_size: rowSize,
          column_size: columnSize,
          column_width: columnWidths,
          ...(mergeInfo.length > 0 ? { merge_info: mergeInfo } : {}),
        },
        cells: cellIds,
      },
    },
    cellDescendants,
  };
}
