/**
 * 内容清理模块
 * 处理 blob URL、外部图片等无效内容
 * 使用代码块保护机制，避免误伤代码块内的内容
 */

import { EXTERNAL_IMAGE_EMOJI } from "./constants.js";
import { extractCodeBlocks, restoreCodeBlocks } from "./card-optimize.js";

export interface SanitizeResult {
  content: string;
  warnings: string[];
}

/**
 * 清理内容中的无效 URL
 * 1. blob: URL - 完全移除
 * 2. 外部图片 URL - 转为链接 + emoji
 *
 * 代码块内的内容受保护，不会被误处理
 */
export function sanitizeContent(content: string): SanitizeResult {
  const warnings: string[] = [];

  // 0. 提取代码块，保护内部内容不被误处理
  const { text, codes } = extractCodeBlocks(content);
  let processed = text;

  // 1. 处理 blob URL
  const blobMatches = processed.match(/!\[[^\]]*\]\(blob:[^)]+\)/gi) || [];
  if (blobMatches.length > 0) {
    console.warn(`[WARN] Filtered ${blobMatches.length} blob URL image(s)`);

    // 移除 Markdown 图片 ![...](blob:...)
    processed = processed.replace(/!\[[^\]]*\]\(blob:[^)]+\)/gi, '');

    // 保留文字，移除 blob 链接 [...](blob:...)
    processed = processed.replace(/\[([^\]]+)\]\(blob:[^)]+\)/gi, '$1');

    // 移除独立的 blob URL
    processed = processed.replace(/blob:https?:\/\/[^\s\)]+/gi, '');

    warnings.push(`已过滤 ${blobMatches.length} 个无效图片`);
  }

  // 2. 处理外部图片（非 blob: 的 https?:// 图片）
  // 飞书卡片/文档不支持外部图片 URL，转为普通链接
  const externalImgMatches = processed.match(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/gi) || [];
  if (externalImgMatches.length > 0) {
    console.warn(`[WARN] Converting ${externalImgMatches.length} external image URL(s) to links`);

    // 转换：![alt](https://...) → [alt](https://...) 🖼️
    processed = processed.replace(
      /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/gi,
      (_, alt, url) => {
        const displayText = alt || "图片";
        return `[${displayText}](${url}) ${EXTERNAL_IMAGE_EMOJI}`;
      }
    );

    warnings.push(`已转换 ${externalImgMatches.length} 个外部图片为链接`);
  }

  // 3. 恢复代码块
  processed = restoreCodeBlocks(processed, codes);

  return { content: processed, warnings };
}

/**
 * 格式化警告消息
 */
export function formatWarnings(warnings: string[]): string {
  if (warnings.length === 0) return "";
  return "\n\n（" + warnings.join("，") + "）";
}
