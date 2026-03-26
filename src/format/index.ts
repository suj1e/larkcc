/**
 * 飞书格式处理模块
 * 包含样式常量、内容清理、卡片处理、文档处理、解析器、块构建器
 */

// 常量
export * from "./constants.js";

// 内容清理
export { sanitizeContent, formatWarnings } from "./sanitize.js";
export type { SanitizeResult } from "./sanitize.js";

// 卡片处理
export {
  buildMarkdownCard,
  buildTextCard,
  buildStatusCard,
  sendMarkdownCardMessage,
} from "./card.js";

// 文档处理
export { markdownToBlocks } from "./document.js";
export type { DocumentMeta } from "./document.js";

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
  buildTableBlock,
} from "./builder.js";
export type { Block, TextElement, TableData } from "./builder.js";
