import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fetchWithProxy } from "./client.js";
import { countTables, markdownToBlocks, BlockType, parseInlineText } from "../format/index.js";
import type { Block, DocumentMeta, CalloutCreateData } from "../format/index.js";

// ── 文档注册表（本地追踪创建的文档，每个 profile 独立文件）──────────

interface DocumentRecord {
  id: string;
  createdAt: number;
}

const DOC_REGISTRY_DIR = path.join(os.homedir(), ".larkcc");

function getDocRegistryPath(profile: string): string {
  if (!profile || profile === "default") {
    return path.join(DOC_REGISTRY_DIR, "doc-registry.json");
  }
  return path.join(DOC_REGISTRY_DIR, `doc-registry-${profile}.json`);
}

function loadDocRegistry(profile: string): DocumentRecord[] {
  try {
    const filePath = getDocRegistryPath(profile);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch {}
  return [];
}

function saveDocRegistry(profile: string, records: DocumentRecord[]): void {
  if (!fs.existsSync(DOC_REGISTRY_DIR)) {
    fs.mkdirSync(DOC_REGISTRY_DIR, { recursive: true });
  }
  const filePath = getDocRegistryPath(profile);
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf8");
}

export function registerDocument(docId: string, profile: string): void {
  const records = loadDocRegistry(profile);
  records.push({ id: docId, createdAt: Date.now() });
  saveDocRegistry(profile, records);
}

function getOldestDocuments(profile: string, keepCount: number): DocumentRecord[] {
  const records = loadDocRegistry(profile);
  const sortedDocs = [...records].sort((a, b) => a.createdAt - b.createdAt);
  if (sortedDocs.length <= keepCount) return [];
  return sortedDocs.slice(0, sortedDocs.length - keepCount);
}

function removeDocumentRecord(docId: string, profile: string): void {
  const records = loadDocRegistry(profile);
  const filtered = records.filter(r => r.id !== docId);
  saveDocRegistry(profile, filtered);
}

// ── JSON 响应解析 ──────────────────────────────────────────────

async function safeJsonParse(res: { ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }, context: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${context} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${context} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

// ── 云文档创建 ─────────────────────────────────────────────────

export async function createOverflowDocument(
  token: string,
  title: string,
  markdown: string,
  originalMessage: string,
  meta: DocumentMeta
): Promise<{ docUrl: string; docId: string; warnings: string[] }> {
  // 优先使用 MCP 创建
  try {
    const headerLines: string[] = [];
    if (originalMessage) {
      headerLines.push(`> ${originalMessage}`);
      headerLines.push('');
      headerLines.push('---');
      headerLines.push('');
    }
    headerLines.push(`- 📁 **工作目录**: ${meta.cwd}`);
    headerLines.push(`- 🤖 **机器人**: ${meta.profile}`);
    headerLines.push(`- 🔗 **会话ID**: ${meta.sessionId || "首次对话"}`);
    headerLines.push(`- 📅 **时间**: ${meta.datetime}`);
    headerLines.push('');
    const fullMarkdown = headerLines.join('\n') + '\n' + markdown;

    const result = await createDocViaMCP(token, title, fullMarkdown);
    if (result) {
      console.error(`[DOC] Document created via MCP: ${result.docId}`);
      return result;
    }
  } catch (error) {
    console.error(`[DOC] MCP creation failed, falling back to block API:`, error);
  }

  // Fallback: 逐块写入
  const { items } = markdownToBlocks(markdown, originalMessage, meta);

  const createRes = await fetchWithProxy("https://open.feishu.cn/open-apis/docx/v1/documents", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title }),
  });
  const createData = await safeJsonParse(createRes, "Create document") as { data?: { document?: { document_id?: string } } };
  const docId = createData.data?.document?.document_id;

  if (!docId) {
    throw new Error("Failed to create document");
  }

  const BATCH_SIZE = 50;
  let simpleBatch: Block[] = [];
  let isFirstBatch = true;
  let batchIndex = 0;
  const writeWarnings: string[] = [];

  const flushSimpleBatch = async () => {
    if (simpleBatch.length === 0) return;
    batchIndex++;
    const index = isFirstBatch ? 0 : -1;
    const batchTypes = simpleBatch.map(b => b.block_type);

    try {
      await batchCreateBlocks(token, docId, docId, simpleBatch, index);
      isFirstBatch = false;
    } catch (error) {
      const errMsg = `Batch ${batchIndex} 写入失败（${simpleBatch.length} 个块），已跳过`;
      console.error(`[DOC] ${errMsg}:`, error);
      console.error(`[DOC] Block types: [${batchTypes.join(", ")}]`);
      writeWarnings.push(errMsg);
    } finally {
      simpleBatch = [];
    }
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    switch (item.type) {
      case "simple":
        simpleBatch.push(item.block);
        if (simpleBatch.length >= BATCH_SIZE) {
          await flushSimpleBatch();
        }
        break;

      case "table":
        await flushSimpleBatch();
        {
          const tableProp = item.data.property;
          const rawMd = item.data.rawMarkdown ?? "";
          writeWarnings.push(`表格渲染失败（${tableProp.row_size}行 × ${tableProp.column_size}列）`);
          const fallbackContent = rawMd
            ? `⚠️ 表格渲染失败（${tableProp.row_size}行 × ${tableProp.column_size}列），原始内容：\n${rawMd}`
            : `⚠️ 表格渲染失败（${tableProp.row_size}行 × ${tableProp.column_size}列）`;
          simpleBatch.push({
            block_type: BlockType.CODE,
            code: {
              style: { language: 1, wrap: true },
              elements: [{ text_run: { content: fallbackContent } }],
            },
          });
        }
        break;

      case "callout":
        await flushSimpleBatch();
        try {
          await createCalloutViaChildren(token, docId, item.data);
        } catch (error) {
          console.error(`[DOC] Callout creation failed at item ${i}:`, error);
          writeWarnings.push("高亮块渲染失败");
          simpleBatch.push({
            block_type: BlockType.QUOTE,
            quote: { elements: [{ text_run: { content: item.data.textLines.join("\n") } }] },
          });
        }
        break;
    }
  }

  await flushSimpleBatch();

  return {
    docUrl: `https://feishu.cn/docx/${docId}`,
    docId,
    warnings: writeWarnings,
  };
}

async function createDocViaMCP(
  token: string,
  title: string,
  markdown: string,
): Promise<{ docUrl: string; docId: string; warnings: string[] }> {
  const body = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "tools/call",
    params: {
      name: "create-doc",
      arguments: { title, markdown },
    },
  };

  const res = await fetchWithProxy("https://mcp.feishu.cn/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Lark-MCP-TAT": token,
      "X-Lark-MCP-Allowed-Tools": "create-doc",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`MCP HTTP ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json() as { error?: { code: number; message: string }; result?: { content?: Array<{ text?: string }> } };

  if (data.error) {
    throw new Error(`MCP error (${data.error.code}): ${data.error.message}`);
  }

  const content = data.result?.content?.[0]?.text;
  if (!content) {
    throw new Error("MCP response missing content");
  }

  const docInfo = JSON.parse(content) as {
    doc_id?: string;
    doc_url?: string;
    message?: string;
  };

  if (!docInfo.doc_id) {
    throw new Error(`MCP did not return doc_id: ${docInfo.message ?? content}`);
  }

  return {
    docUrl: docInfo.doc_url ?? `https://feishu.cn/docx/${docInfo.doc_id}`,
    docId: docInfo.doc_id,
    warnings: [],
  };
}

async function batchCreateBlocks(
  token: string,
  docId: string,
  parentId: string,
  children: Block[],
  index: number
): Promise<string[]> {
  const url = `https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks/${parentId}/children`;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetchWithProxy(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ children, index }),
    });

    if (res.status === 429 && attempt < maxRetries) {
      const delay = attempt * 2000;
      console.warn(`[DOC] Rate limited (429), retry ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    const data = await safeJsonParse(res, "Batch create blocks") as {
      code?: number;
      msg?: string;
      data?: { children?: Array<{ block_id?: string; block_type?: number }> };
    };

    if (data.code !== 0) {
      console.error(`[DOC] API error response:`, JSON.stringify(data, null, 2));
      throw new Error(`Write content failed (${data.code}): ${data.msg}`);
    }

    return data.data?.children?.map(c => c.block_id ?? "").filter(Boolean) ?? [];
  }

  throw new Error("Write content failed after rate limit retries");
}

async function createCalloutViaChildren(
  token: string,
  docId: string,
  calloutData: CalloutCreateData,
): Promise<void> {
  const calloutBlock: Block = {
    block_type: 19,
    callout: calloutData.callout,
  };

  const calloutIds = await batchCreateBlocks(token, docId, docId, [calloutBlock], -1);
  const calloutId = calloutIds[0];
  if (!calloutId) throw new Error("Failed to get callout block_id");

  if (calloutData.textLines.length > 0) {
    const textBlocks: Block[] = calloutData.textLines.map(line => ({
      block_type: 2,
      text: { elements: parseInlineText(line) },
    }));
    await batchCreateBlocks(token, docId, calloutId, textBlocks, -1);
  }
}

// ── 清理旧文档 ─────────────────────────────────────────────────

export async function cleanupOldDocuments(
  token: string,
  maxDocs: number,
  profile: string
): Promise<{ deleted: number; failed: number }> {
  const result = { deleted: 0, failed: 0 };

  try {
    const toDelete = getOldestDocuments(profile, maxDocs);

    for (const doc of toDelete) {
      try {
        const deleteRes = await fetchWithProxy(`https://open.feishu.cn/open-apis/drive/v1/files/${doc.id}?type=docx`, {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${token}` },
        });
        const deleteData = await safeJsonParse(deleteRes, "Delete document") as { code?: number };

        if (deleteData.code === 0 || deleteData.code === 1061003 || deleteData.code === 1061007) {
          result.deleted++;
          removeDocumentRecord(doc.id, profile);
        } else {
          result.failed++;
          console.error(`[CLEANUP] Failed to delete ${doc.id}:`, JSON.stringify(deleteData));
        }
      } catch (error) {
        result.failed++;
        console.error(`[CLEANUP] Network error deleting ${doc.id}:`, error);
      }
    }
  } catch (error) {
    console.error("[CLEANUP] Error:", error);
  }

  return result;
}
