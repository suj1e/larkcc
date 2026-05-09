/**
 * 图片解析模块
 *
 * 将 Markdown 中的外部图片 URL 下载并上传到飞书，
 * 替换为飞书内部的 img_xxx 格式 key。
 *
 * 处理流程：
 * 1. 提取代码块（保护代码内容）
 * 2. 扫描 ![alt](https?://...) 模式
 * 3. 串行下载 + 上传（避免触发速率限制）
 * 4. 替换 URL → img_xxx
 * 5. 恢复代码块
 *
 * 失败的图片保留原始 URL，由后续 sanitizeContent 降级为链接。
 */

import { extractCodeBlocks, restoreCodeBlocks } from "../format/card-optimize.js";
import { fetchWithProxy } from "./client.js";

// ── 常量 ───────────────────────────────────────────────────

const IMAGE_UPLOAD_URL = "https://open.feishu.cn/open-apis/im/v1/images";
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const DOWNLOAD_TIMEOUT_MS = 10000; // 10s

// 飞书/Lark 内部 CDN 域名，这些图片需要登录态，外部无法下载
const INTERNAL_DOMAINS = ["feishucdn.com", "larksuitecdn.com", "feishu.cn", "larksuite.com"];

// ── 类型 ───────────────────────────────────────────────────

export interface ImageResolveResult {
  /** 替换后的 Markdown 内容 */
  content: string;
  /** 成功上传的图片数 */
  uploaded: number;
  /** 上传失败的图片数 */
  failed: number;
}

// ── 主函数 ───────────────────────────────────────────────────

/**
 * 解析 Markdown 中的外部图片，下载并上传到飞书
 *
 * @param markdown 原始 Markdown 内容
 * @param token tenant_access_token
 * @returns 替换后的内容和统计信息
 */
export async function resolveImages(
  markdown: string,
  token: string,
): Promise<ImageResolveResult> {
  // 1. 提取代码块，保护内部内容
  const { text, codes } = extractCodeBlocks(markdown);

  let uploaded = 0;
  let failed = 0;
  let result = text;

  // 2. 收集所有需要处理的图片（排除 img_ 已解析的、非 http/https 的）
  const imageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/gi;
  const matches: Array<{ full: string; alt: string; url: string }> = [];
  let regexMatch: RegExpExecArray | null;
  while ((regexMatch = imageRegex.exec(text)) !== null) {
    matches.push({
      full: regexMatch[0],
      alt: regexMatch[1],
      url: regexMatch[2],
    });
  }

  if (matches.length === 0) {
    return { content: restoreCodeBlocks(text, codes), uploaded: 0, failed: 0 };
  }

  console.error(`[IMAGE] Found ${matches.length} external image(s), resolving...`);

  // 3. 串行处理每张图片
  for (const { full, alt, url } of matches) {
    // 跳过飞书/Lark 内部 CDN 图片（需要登录态，无法下载）
    try {
      const hostname = new URL(url).hostname;
      if (INTERNAL_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`))) {
        console.error(`[IMAGE] Skipped (internal CDN): ${url.slice(0, 80)}`);
        continue;
      }
    } catch {
      // URL 解析失败，继续尝试下载
    }

    try {
      // 下载
      const buffer = await downloadExternalImage(url);
      if (!buffer) {
        failed++;
        continue;
      }

      // 上传到飞书
      const imageKey = await uploadImageToFeishu(buffer, token);
      if (!imageKey) {
        failed++;
        continue;
      }

      // 替换 URL → img_xxx
      result = result.replace(full, `![${alt}](${imageKey})`);
      uploaded++;
    } catch (error) {
      console.error(`[IMAGE] Failed to resolve ${url.slice(0, 80)}:`, error);
      failed++;
    }
  }

  // 4. 恢复代码块
  const finalContent = restoreCodeBlocks(result, codes);

  if (uploaded > 0 || failed > 0) {
    console.error(`[IMAGE] Resolution complete: ${uploaded} uploaded, ${failed} failed`);
  }

  return { content: finalContent, uploaded, failed };
}

// ── 图片下载 ───────────────────────────────────────────────────

/**
 * 下载外部图片
 * 支持超时和大小检查
 */
async function downloadExternalImage(url: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetchWithProxy(url, {
      signal: controller.signal,
      headers: {
        // 添加 User-Agent 避免某些服务器拒绝无 UA 请求
        "User-Agent": "larkcc/1.0",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[IMAGE] Download failed: ${response.status} ${url.slice(0, 80)}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_IMAGE_SIZE) {
      console.error(`[IMAGE] Too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB) ${url.slice(0, 80)}`);
      return null;
    }

    if (buffer.length < 100) {
      console.error(`[IMAGE] Too small: ${buffer.length} bytes, likely not an image ${url.slice(0, 80)}`);
      return null;
    }

    return buffer;
  } catch (error: any) {
    clearTimeout(timeout);
    if (error.name === "AbortError") {
      console.error(`[IMAGE] Download timeout (${DOWNLOAD_TIMEOUT_MS}ms): ${url.slice(0, 80)}`);
    } else {
      console.error(`[IMAGE] Download error: ${url.slice(0, 80)}`, error);
    }
    return null;
  }
}

// ── 图片上传 ───────────────────────────────────────────────────

/**
 * 上传图片到飞书
 *
 * API: POST /open-apis/im/v1/images
 * Content-Type: multipart/form-data
 * Form: image_type=message, image=<binary>
 */
async function uploadImageToFeishu(buffer: Buffer, token: string): Promise<string | null> {
  try {
    // 检测图片类型
    const header = buffer.slice(0, 4).toString("hex");
    let mediaType = "image/jpeg";
    let ext = "jpg";
    if (header.startsWith("89504e47")) { mediaType = "image/png"; ext = "png"; }
    else if (header.startsWith("47494638")) { mediaType = "image/gif"; ext = "gif"; }
    else if (header.startsWith("52494646")) { mediaType = "image/webp"; ext = "webp"; }
    else if (header.startsWith("00000100")) { mediaType = "image/ico"; ext = "ico"; }

    const formData = new FormData();
    formData.append("image_type", "message");
    formData.append("image", new Blob([new Uint8Array(buffer)], { type: mediaType }), `image.${ext}`);

    const response = await fetchWithProxy(IMAGE_UPLOAD_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error(`[IMAGE] Upload API error: ${response.status} ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await response.json() as any;

    if (data.code !== 0) {
      console.error(`[IMAGE] Upload failed (${data.code}): ${data.msg}`);
      return null;
    }

    const imageKey: string | undefined = data.data?.image_key;
    if (!imageKey) {
      console.error("[IMAGE] No image_key in upload response");
      return null;
    }

    const sizeKB = Math.round(buffer.length / 1024);
    console.error(`[IMAGE] Uploaded: ${imageKey} (${mediaType}, ${sizeKB}KB)`);
    return imageKey;
  } catch (error) {
    console.error("[IMAGE] Upload error:", error);
    return null;
  }
}
