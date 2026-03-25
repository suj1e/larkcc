/**
 * 内容清理模块
 * 处理 blob URL、外部图片等无效内容
 */

import { EXTERNAL_IMAGE_EMOJI } from "./constants.js";

export interface SanitizeResult {
  content: string;
  warnings: string[];
}

/**
 * 清理内容中的无效 URL
 * 1. blob: URL - 完全移除
 * 2. 外部图片 URL - 转为链接 + emoji
 */
export function sanitizeContent(content: string): SanitizeResult {
  const warnings: string[] = [];

  // 1. 处理 blob URL
  const blobMatches = content.match(/!\[[^\]]*\]\(blob:[^)]+\)/gi) || [];
  if (blobMatches.length > 0) {
    console.warn(`[WARN] Filtered ${blobMatches.length} blob URL image(s)`);

    // 移除 Markdown 图片 ![...](blob:...)
    content = content.replace(/!\[[^\]]*\]\(blob:[^)]+\)/gi, '');

    // 保留文字，移除 blob 链接 [...](blob:...)
    content = content.replace(/\[([^\]]+)\]\(blob:[^)]+\)/gi, '$1');

    // 移除独立的 blob URL
    content = content.replace(/blob:https?:\/\/[^\s\)]+/gi, '');

    warnings.push(`已过滤 ${blobMatches.length} 个无效图片`);
  }

  // 2. 处理外部图片（非 blob: 的 https?:// 图片）
  // 飞书卡片/文档不支持外部图片 URL，转为普通链接
  const externalImgMatches = content.match(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/gi) || [];
  if (externalImgMatches.length > 0) {
    console.warn(`[WARN] Converting ${externalImgMatches.length} external image URL(s) to links`);

    // 转换：![alt](https://...) → [alt](https://...) 🖼️
    content = content.replace(
      /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/gi,
      (_, alt, url) => {
        const displayText = alt || "图片";
        return `[${displayText}](${url}) ${EXTERNAL_IMAGE_EMOJI}`;
      }
    );

    warnings.push(`已转换 ${externalImgMatches.length} 个外部图片为链接`);
  }

  return { content, warnings };
}

/**
 * 格式化警告消息
 */
export function formatWarnings(warnings: string[]): string {
  if (warnings.length === 0) return "";
  return "\n\n（" + warnings.join("，") + "）";
}
