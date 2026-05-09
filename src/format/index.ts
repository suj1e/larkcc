/**
 * 飞书格式处理模块
 * 包含样式常量、内容清理、卡片处理、文档处理、解析器、块构建器
 */

// 常量
export * from "./constants.js";

// 内容清理
export { sanitizeContent, formatWarnings } from "./sanitize.js";
export type { SanitizeResult } from "./sanitize.js";

// 文档处理
export { markdownToBlocks } from "./doc.js";
export type { DocumentMeta } from "./doc.js";

// 解析器
export {
  parseTable,
  parseTodo,
  parseBlockEquation,
  parseInlineEquation,
  parseCallout,
  parseHeading,
  isCodeBlockStart,
  isCodeBlockEnd,
  isDivider,
  isBulletList,
  isOrderedList,
  parseBulletList,
  parseOrderedList,
  isQuote,
  countTables,
} from "./parser.js";
export type { TodoParseResult, EquationParseResult, CalloutParseResult } from "./parser.js";

// 块构建器
export {
  parseInlineText,
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
  buildImageBlock,
  buildTableBlock,
} from "./builder.js";
export type { Block, TextElement, TextElementStyle, TableData, DocumentBlockItem, CalloutCreateData, TableCreateData, CellData } from "./builder.js";

// 卡片优化
export { optimizeForCard, truncateSafely } from "./card-optimize.js";

// Thinking 解析
export { parseThinking, stripThinking } from "./thinking.js";
export type { ThinkingResult } from "./thinking.js";
