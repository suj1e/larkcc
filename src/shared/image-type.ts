/**
 * 图片类型检测
 *
 * 统一 magic byte 检测逻辑，消除 download.ts / image-resolver.ts 两处重复。
 */

export interface ImageTypeInfo {
  mediaType: string;
  ext: string;
}

const SIGNATURES: Array<{ hex: string; mediaType: string; ext: string }> = [
  { hex: "89504e47", mediaType: "image/png",  ext: "png" },
  { hex: "47494638", mediaType: "image/gif",  ext: "gif" },
  { hex: "52494646", mediaType: "image/webp", ext: "webp" },
  { hex: "00000100", mediaType: "image/ico",  ext: "ico" },
];

export function detectImageType(buf: Buffer): ImageTypeInfo {
  const header = buf.slice(0, 4).toString("hex");
  for (const sig of SIGNATURES) {
    if (header.startsWith(sig.hex)) {
      return { mediaType: sig.mediaType, ext: sig.ext };
    }
  }
  return { mediaType: "image/jpeg", ext: "jpg" };
}
