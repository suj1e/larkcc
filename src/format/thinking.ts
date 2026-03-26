/**
 * Thinking 标签解析模块
 *
 * 处理 Claude 扩展思考输出的 <thinking>...</thinking> 标签
 * 支持流式场景中的不完整标签（未闭合的 thinking 块）
 */

export interface ThinkingResult {
  /** 提取的思考内容 */
  thinking: string;
  /** 去除思考标签后的正文内容 */
  content: string;
  /** 是否存在未闭合的 thinking 块（流式输出中） */
  isThinking: boolean;
}

/**
 * 解析文本中的 <thinking> 标签
 *
 * 处理逻辑：
 * 1. 提取所有完整的 <thinking>...</thinking> 块
 * 2. 检测未闭合的 <thinking> 块（流式场景）
 * 3. 返回分离后的 thinking 和 content
 */
export function parseThinking(text: string): ThinkingResult {
  let thinking = '';
  let content = text;
  let isThinking = false;

  // 提取所有完整的 <thinking>...</thinking> 块
  content = content.replace(/<thinking>([\s\S]*?)<\/thinking>/g, (_match: string, inner: string) => {
    thinking += inner;
    return '';
  });

  // 检测未闭合的 thinking 块
  const openIdx = content.indexOf('<thinking>');
  if (openIdx !== -1) {
    thinking += content.slice(openIdx + '<thinking>'.length);
    content = content.slice(0, openIdx);
    isThinking = true;
  }

  return {
    thinking: thinking.trim(),
    content: content.trim(),
    isThinking,
  };
}

/**
 * 移除文本中的所有 thinking 标签
 *
 * 用于 thinking_enabled=false 时，完全过滤思考内容
 */
export function stripThinking(text: string): string {
  let result = text;
  // 移除完整的 <thinking>...</thinking> 块
  result = result.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
  // 移除未闭合的 <thinking> 块
  result = result.replace(/<thinking>[\s\S]*$/g, '');
  return result.trim();
}
