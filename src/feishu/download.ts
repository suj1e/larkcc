import * as lark from "@larksuiteoapi/node-sdk";
import * as fs from "fs";
import * as path from "path";

// ── 图片下载 ─────────────────────────────────────────────────

export async function downloadImage(
  client: lark.Client,
  messageId: string,
  imageKey: string,
): Promise<{ base64: string; mediaType: string } | null> {
  try {
    console.error(`[IMAGE] Downloading image: ${imageKey}`);
    const res = await client.im.messageResource.get({
      path: { message_id: messageId, file_key: imageKey },
      params: { type: "image" },
    });
    const stream = (res as any).getReadableStream();
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: any) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    const buf = Buffer.concat(chunks);
    const base64 = buf.toString("base64");
    const header = buf.slice(0, 4).toString("hex");
    let mediaType = "image/jpeg";
    if (header.startsWith("89504e47")) mediaType = "image/png";
    else if (header.startsWith("47494638")) mediaType = "image/gif";
    else if (header.startsWith("52494646")) mediaType = "image/webp";
    const sizeKB = Math.round(buf.length / 1024);
    console.error(`[IMAGE] Downloaded: ${mediaType}, ${sizeKB}KB, base64=${base64.length}chars`);
    return { base64, mediaType };
  } catch (e) {
    console.error(`[IMAGE] Download failed:`, e);
    return null;
  }
}

// ── 文件下载 ─────────────────────────────────────────────────

export interface DownloadedFile {
  filepath: string;
  filename: string;
  size: number;
  mime_type: string;
  file_key: string;
}

export async function downloadFile(
  client: lark.Client,
  messageId: string,
  fileKey: string,
  tempDir: string,
  filename: string,
): Promise<DownloadedFile | null> {
  try {
    console.error(`[FILE] Downloading file: ${fileKey}, name: ${filename}`);

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const res = await client.im.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type: "file" },
    });
    const stream = (res as any).getReadableStream();
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: any) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    const buf = Buffer.concat(chunks);

    const timestamp = Date.now();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueName = `${timestamp}_${safeName}`;
    const filepath = path.join(tempDir, uniqueName);

    fs.writeFileSync(filepath, buf);

    const mimeTypes: Record<string, string> = {
      "pdf": "application/pdf",
      "doc": "application/msword",
      "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "xls": "application/vnd.ms-excel",
      "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "ppt": "application/vnd.ms-powerpoint",
      "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "txt": "text/plain",
      "md": "text/markdown",
      "csv": "text/csv",
      "json": "application/json",
      "xml": "application/xml",
      "yaml": "application/x-yaml",
      "yml": "application/x-yaml",
      "js": "application/javascript",
      "ts": "application/typescript",
      "py": "text/x-python",
      "java": "text/x-java",
      "go": "text/x-go",
      "rs": "text/x-rust",
      "c": "text/x-c",
      "cpp": "text/x-c++",
      "h": "text/x-c",
      "hpp": "text/x-c++",
      "sh": "application/x-sh",
      "bash": "application/x-sh",
      "zip": "application/zip",
      "tar": "application/x-tar",
      "gz": "application/gzip",
      "rar": "application/vnd.rar",
      "7z": "application/x-7z-compressed",
      "html": "text/html",
      "css": "text/css",
    };

    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const mime_type = mimeTypes[ext] || "application/octet-stream";

    const sizeKB = Math.round(buf.length / 1024);
    console.error(`[FILE] Downloaded: ${mime_type}, ${sizeKB}KB, saved to ${filepath}`);

    return { filepath, filename, size: buf.length, mime_type, file_key: fileKey };
  } catch (e) {
    console.error(`[FILE] Download failed:`, e);
    return null;
  }
}
