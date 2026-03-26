/**
 * Markdown 解析器
 * 解析表格、任务列表、公式、高亮块等
 */

import { CalloutType } from "./constants.js";
import { TableData, TableCell, CellMerge } from "./builder.js";

// ── 表格解析 ───────────────────────────────────────────────────

/**
 * 解析表格对齐方式
 * :--- 左对齐, :---: 居中, ---: 右对齐
 */
function parseAlignment(cell: string): "left" | "center" | "right" {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

/**
 * 解析单元格中的 HTML 标签
 * 支持 <td colspan="2"> 和 <td rowspan="2">
 */
function parseCellHtml(cell: string): TableCell {
  const trimmed = cell.trim();

  // 匹配 <td colspan="2" rowspan="1">content</td> 或 <td>content</td>
  const tdMatch = trimmed.match(/^<td\s+([^>]*)>([^]*)<\/td>$/i);
  if (tdMatch) {
    const attrs = tdMatch[1];
    const content = tdMatch[2].trim();

    const result: TableCell = { content };

    // 解析 colspan
    const colspanMatch = attrs.match(/colspan\s*=\s*["']?(\d+)["']?/i);
    if (colspanMatch) {
      const colspan = parseInt(colspanMatch[1], 10);
      if (colspan > 1) {
        result.merge = { colspan, rowspan: 1 };
      }
    }

    // 解析 rowspan
    const rowspanMatch = attrs.match(/rowspan\s*=\s*["']?(\d+)["']?/i);
    if (rowspanMatch) {
      const rowspan = parseInt(rowspanMatch[1], 10);
      if (rowspan > 1) {
        result.merge = { ...(result.merge || { colspan: 1 }), rowspan };
      }
    }

    return result;
  }

  // 普通 Markdown 单元格
  return { content: trimmed };
}

/**
 * 解析表格行
 */
function parseTableRow(line: string): TableCell[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;

  return trimmed
    .slice(1, -1)
    .split("|")
    .map(cell => parseCellHtml(cell));
}

/**
 * 检查是否为表格分隔行
 */
function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;

  const cells = trimmed
    .slice(1, -1)
    .split("|")
    .map(c => c.trim());

  return cells.every(cell => /^:?-+:?$/.test(cell));
}

/**
 * 解析 Markdown 表格
 * 支持：
 * - 标准 Markdown 表格
 * - HTML colspan/rowspan: <td colspan="2">content</td>
 * @returns 表格数据和结束行索引，如果不是表格返回 null
 */
export function parseTable(lines: string[], startIndex: number): { data: TableData; endIndex: number } | null {
  if (startIndex >= lines.length) return null;

  // 第一行必须是表头
  const headerRow = parseTableRow(lines[startIndex]);
  if (!headerRow || headerRow.length === 0) return null;

  // 第二行必须是分隔符
  if (startIndex + 1 >= lines.length) return null;
  if (!isTableSeparator(lines[startIndex + 1])) return null;

  // 解析对齐方式
  const separatorLine = lines[startIndex + 1].trim();
  const separatorCells = separatorLine
    .slice(1, -1)
    .split("|")
    .map(c => c.trim());
  const alignments = separatorCells.map(parseAlignment);

  // 应用对齐到表头
  headerRow.forEach((cell, i) => {
    if (i < alignments.length && alignments[i] !== "left") {
      cell.align = alignments[i];
    }
  });

  const rows: TableCell[][] = [headerRow];
  const columnCount = headerRow.length;

  // 解析数据行
  let endIndex = startIndex + 2;
  while (endIndex < lines.length) {
    const row = parseTableRow(lines[endIndex]);
    if (!row) break;

    // 应用对齐到数据行
    row.forEach((cell, i) => {
      if (i < alignments.length && alignments[i] !== "left") {
        cell.align = alignments[i];
      }
    });

    // 补齐列数
    while (row.length < columnCount) row.push({ content: "" });
    rows.push(row.slice(0, columnCount));
    endIndex++;
  }

  return {
    data: { rows },
    endIndex: endIndex - 1,
  };
}

// ── 任务列表解析 ───────────────────────────────────────────────────

export interface TodoParseResult {
  content: string;
  checked: boolean;
}

/**
 * 解析任务列表
 * - [ ] 未完成
 * - [x] 已完成
 */
export function parseTodo(line: string): TodoParseResult | null {
  const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
  if (!match) return null;

  return {
    checked: match[1].toLowerCase() === "x",
    content: match[2].trim(),
  };
}

// ── 数学公式解析 ───────────────────────────────────────────────────

export interface EquationParseResult {
  latex: string;
  inline: boolean;
}

/**
 * 解析块级公式 $$...$$
 */
export function parseBlockEquation(lines: string[], startIndex: number): { result: EquationParseResult; endIndex: number } | null {
  const line = lines[startIndex].trim();

  // 单行公式：$$E = mc^2$$
  const singleLineMatch = line.match(/^\$\$([^$]+)\$\$$/);
  if (singleLineMatch) {
    return {
      result: { latex: singleLineMatch[1].trim(), inline: false },
      endIndex: startIndex,
    };
  }

  // 多行公式：$$ 开头
  if (line !== "$$") return null;

  const latexLines: string[] = [];
  let endIndex = startIndex + 1;

  while (endIndex < lines.length) {
    if (lines[endIndex].trim() === "$$") {
      return {
        result: { latex: latexLines.join("\n"), inline: false },
        endIndex,
      };
    }
    latexLines.push(lines[endIndex]);
    endIndex++;
  }

  return null;
}

/**
 * 解析行内公式 $...$
 */
export function parseInlineEquation(text: string): { latex: string; remaining: string } | null {
  const match = text.match(/^\$([^$]+)\$/);
  if (!match) return null;

  return {
    latex: match[1].trim(),
    remaining: text.slice(match[0].length),
  };
}

// ── 高亮块解析 ───────────────────────────────────────────────────

export interface CalloutParseResult {
  type: CalloutType;
  content: string[];
}

/**
 * 解析高亮块
 * > [!NOTE]
 * > 这是一个提示
 *
 * > [!WARNING]
 * > 这是一个警告
 */
export function parseCallout(lines: string[], startIndex: number): { result: CalloutParseResult; endIndex: number } | null {
  const line = lines[startIndex].trim();

  // 匹配 > [!TYPE]
  const headerMatch = line.match(/^>\s*\[!(\w+)\]\s*$/);
  if (!headerMatch) return null;

  const type = headerMatch[1].toUpperCase() as CalloutType;
  const content: string[] = [];
  let endIndex = startIndex + 1;

  // 收集后续的引用行
  while (endIndex < lines.length) {
    const nextLine = lines[endIndex].trim();
    if (nextLine.startsWith("> ")) {
      content.push(nextLine.slice(2));
      endIndex++;
    } else if (nextLine === ">") {
      endIndex++;
    } else {
      break;
    }
  }

  return {
    result: { type, content },
    endIndex: endIndex - 1,
  };
}

// ── 辅助函数 ───────────────────────────────────────────────────

/**
 * 检测标题级别
 * @returns 标题级别 (1-6)，0 表示不是标题
 */
export function parseHeading(line: string): number {
  const match = line.match(/^(#{1,6})\s/);
  return match ? match[1].length : 0;
}

/**
 * 检测是否为代码块开始
 */
export function isCodeBlockStart(line: string): { isStart: boolean; lang: string } {
  const match = line.match(/^```(\w*)/);
  if (match) {
    return { isStart: true, lang: match[1] || "" };
  }
  return { isStart: false, lang: "" };
}

/**
 * 检测是否为代码块结束
 */
export function isCodeBlockEnd(line: string): boolean {
  return line.trim() === "```";
}

/**
 * 检测是否为引用块
 */
export function isQuote(line: string): boolean {
  return line.trim().startsWith("> ");
}

/**
 * 检测是否为无序列表
 */
export function isBulletList(line: string): boolean {
  return /^(\s*)[-*]\s+/.test(line) && !parseTodo(line);
}

/**
 * 检测是否为有序列表
 */
export function isOrderedList(line: string): boolean {
  return /^(\s*)(\d+)\.\s+/.test(line);
}

/**
 * 检测是否为分割线
 */
export function isDivider(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "---" || trimmed === "***" || trimmed === "___";
}

// ── 表格计数 ───────────────────────────────────────────────────

/**
 * 统计 Markdown 中的表格数量（排除代码块内的伪表格）
 * @param markdown Markdown 文本
 * @returns 表格数量
 */
export function countTables(markdown: string): number {
  // 1. 移除代码块，避免代码块内的 | 被误判
  const codeBlockRegex = /```[\s\S]*?```/g;
  const inlineCodeRegex = /`[^`]+`/g;
  const cleanMd = markdown
    .replace(codeBlockRegex, '')
    .replace(inlineCodeRegex, '');

  // 2. 复用 parseTable 逻辑统计表格数量
  const lines = cleanMd.split('\n');
  let count = 0;
  let i = 0;

  while (i < lines.length) {
    const result = parseTable(lines, i);
    if (result) {
      count++;
      i = result.endIndex + 1;
    } else {
      i++;
    }
  }

  return count;
}
