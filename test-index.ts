// 测试飞书 docx API 的 index 参数行为
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const GLOBAL_CONFIG_PATH = path.join(process.env.HOME!, ".larkcc", "config.yml");

async function getToken(appId: string, appSecret: string): Promise<string> {
  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json() as { tenant_access_token?: string };
  if (!data.tenant_access_token) throw new Error("Failed to get token");
  return data.tenant_access_token;
}

async function main() {
  const config = yaml.load(fs.readFileSync(GLOBAL_CONFIG_PATH, "utf8")) as any;
  const token = await getToken(config.feishu.app_id, config.feishu.app_secret);
  console.log(`Token: ${token.slice(0, 20)}...`);

  // 1. 创建测试文档
  console.log("\n=== 1. 创建测试文档 ===");
  const createRes = await fetch("https://open.feishu.cn/open-apis/docx/v1/documents", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: "测试 index 参数" }),
  });
  const createData = await createRes.json() as any;
  console.log(`Status: ${createRes.status}`);
  
  if (createData.code !== 0 || !createData.data?.document?.document_id) {
    console.log("❌ 创建文档失败:", createData);
    return;
  }
  const docId = createData.data.document.document_id;
  console.log(`✅ 文档创建成功: ${docId}`);
  console.log(`   URL: https://feishu.cn/docx/${docId}`);

  // 2. 测试方案 A: index = -1 追加到末尾
  console.log("\n=== 2. 测试方案 A: index = -1 ===");
  
  const blocks = [
    { block_type: 2, text: { elements: [{ text_run: { content: "【第一批】第 1 块 - 应该在最前面" } }] } },
    { block_type: 2, text: { elements: [{ text_run: { content: "【第一批】第 2 块" } }] } },
  ];
  const blocks2 = [
    { block_type: 2, text: { elements: [{ text_run: { content: "【第二批】第 1 块 - 应该在中间" } }] } },
    { block_type: 2, text: { elements: [{ text_run: { content: "【第二批】第 2 块" } }] } },
  ];
  const blocks3 = [
    { block_type: 2, text: { elements: [{ text_run: { content: "【第三批】第 1 块 - 应该在最后面" } }] } },
    { block_type: 2, text: { elements: [{ text_run: { content: "【第三批】第 2 块" } }] } },
  ];

  // 写入第一批 (index: 0)
  const res1 = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks/${docId}/children`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ children: blocks, index: 0 }),
  });
  const data1 = await res1.json() as any;
  console.log(`第一批 (index: 0): code=${data1.code}, msg=${data1.msg || 'ok'}`);

  // 写入第二批 (index: -1，测试追加)
  const res2 = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks/${docId}/children`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ children: blocks2, index: -1 }),
  });
  const data2 = await res2.json() as any;
  console.log(`第二批 (index: -1): code=${data2.code}, msg=${data2.msg || 'ok'}`);

  // 写入第三批 (index: -1，测试追加)
  const res3 = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks/${docId}/children`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ children: blocks3, index: -1 }),
  });
  const data3 = await res3.json() as any;
  console.log(`第三批 (index: -1): code=${data3.code}, msg=${data3.msg || 'ok'}`);

  console.log("\n=== 结果 ===");
  console.log("请打开文档查看顺序：");
  console.log(`https://feishu.cn/docx/${docId}`);
  console.log("\n期望顺序（方案 A 可行）：");
  console.log("  【第一批】第 1 块 - 应该在最前面");
  console.log("  【第一批】第 2 块");
  console.log("  【第二批】第 1 块 - 应该在中间");
  console.log("  【第二批】第 2 块");
  console.log("  【第三批】第 1 块 - 应该在最后面");
  console.log("  【第三批】第 2 块");
  
  console.log("\n如果顺序不对，说明 index: -1 不支持追加，需要用方案 B（累计 index）");
}

main().catch(console.error);
