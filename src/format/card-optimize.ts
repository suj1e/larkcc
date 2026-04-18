/**
 * 卡片 Markdown 优化管线
 *
 * 飞书卡片的 Markdown 渲染能力有限：
 * - 只支持 H4 (####) 和 H5 (#####) 标题
 * - 不支持外部图片 URL（仅 img_xxx 格式）
 * - 代码块内容不应被其他处理逻辑误解析
 *
 * 本模块提供管线式处理，将通用 Markdown 适配为卡片友好的格式。
 */

// ── 代码块保护 ───────────────────────────────────────────────────

const CODE_PLACEHOLDER_PREFIX = "\x00CODE_";
const CODE_PLACEHOLDER_SUFFIX = "\x00";

interface ExtractedCode {
  placeholder: string;
  content: string;
}

/**
 * 提取代码块，替换为占位符
 * 返回替换后的文本和提取的代码块列表
 */
export function extractCodeBlocks(text: string): { text: string; codes: ExtractedCode[] } {
  const codes: ExtractedCode[] = [];
  let result = text;
  let index = 0;

  // 匹配 ```lang\n...\n``` 代码块（包括单行）
  result = result.replace(/(```[^\n]*\n)([\s\S]*?)(```)/g, (_match, open: string, content: string, close: string) => {
    const placeholder = `${CODE_PLACEHOLDER_PREFIX}${index}${CODE_PLACEHOLDER_SUFFIX}`;
    codes.push({ placeholder, content: open + content + close });
    index++;
    return placeholder;
  });

  return { text: result, codes };
}

/**
 * 恢复代码块占位符为原始内容
 */
export function restoreCodeBlocks(text: string, codes: ExtractedCode[]): string {
  let result = text;
  for (const { placeholder, content } of codes) {
    result = result.replace(placeholder, content);
  }
  return result;
}

// ── 标题降级 ───────────────────────────────────────────────────

/**
 * 将 Markdown 标题降级为飞书卡片支持的级别
 * H1 → H4（卡片中最大的标题）
 * H2-H6 → H5（卡片中次级标题）
 */
export function demoteHeadings(text: string): string {
  // H1: # Title → #### Title
  text = text.replace(/^#(\s)/gm, "####$1");
  // H2: ## Title → ##### Title
  text = text.replace(/^##(\s)/gm, "#####$1");
  // H3-H6: ###/####/#####/###### → #####（都降为 H5）
  text = text.replace(/^#{3,6}(\s)/gm, "#####$1");
  return text;
}

// ── 安全截断 ───────────────────────────────────────────────────

/**
 * 安全截断 Markdown 内容
 *
 * 避免在代码块或表格中间截断：
 * 1. 检测未闭合的代码块（奇数个 ```）→ 回退到代码块开始前
 * 2. 检测未闭合的表格 → 回退到表格开始前
 * 3. 极端情况（代码块占大部分）→ 闭合代码块后再截断
 */
export function truncateSafely(text: string, limit: number, suffix = "\n\n..."): string {
  if (text.length <= limit) return text;

  let truncated = text.slice(0, limit);

  // 检测未闭合的代码块
  const codeBlockCount = (truncated.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    // 找到最后一个 ``` 的位置
    const lastCodeStart = truncated.lastIndexOf("```");
    if (lastCodeStart > limit * 0.5) {
      // 代码块占后半部分，回退到代码块前
      truncated = text.slice(0, lastCodeStart).trimEnd();
    } else {
      // 代码块占大部分，闭合它
      truncated = truncated + "\n```";
    }
  }

  // 检测未闭合的表格
  const lines = truncated.split("\n");
  const lastLines = lines.slice(-5);
  const inTable = lastLines.some(l => l.trim().startsWith("|"));
  if (inTable) {
    // 找到最后一个表格开始前的空行
    let tableStart = lines.length - 1;
    while (tableStart >= 0 && lines[tableStart].trim() !== "" && !lines[tableStart].trim().startsWith("|")) {
      tableStart--;
    }
    // 回退到表格前
    let safeEnd = tableStart;
    while (safeEnd > 0 && lines[safeEnd - 1].trim() === "") {
      safeEnd--;
    }
    if (safeEnd > limit * 0.3) {
      truncated = lines.slice(0, safeEnd).join("\n").trimEnd();
    }
  }

  return truncated + suffix;
}

// ── 主优化函数 ───────────────────────────────────────────────────

/**
 * 优化 Markdown 内容以适配飞书卡片渲染
 *
 * 管线顺序：
 * 1. 提取代码块（保护代码内容不被误处理）
 * 2. 标题降级（H1-H6 → H4/H5）
 * 3. 恢复代码块
 */
export function optimizeForCard(markdown: string): string {
  // 1. 提取代码块
  const { text, codes } = extractCodeBlocks(markdown);

  // 2. 标题降级
  let optimized = demoteHeadings(text);

  // 3. 恢复代码块
  optimized = restoreCodeBlocks(optimized, codes);

  return optimized;
}
