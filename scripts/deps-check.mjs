#!/usr/bin/env node

/**
 * 依赖更新检测脚本
 *
 * 检查 package.json 中所有依赖是否有 major/minor 升级，
 * 为每个可升级依赖创建 GitHub Issue（关闭已有的旧 Issue）。
 *
 * 用法:
 *   GITHUB_TOKEN=xxx node scripts/deps-check.mjs
 *
 * CI 中由 GITHUB_TOKEN 自动注入，本地需手动设置。
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── 配置 ──────────────────────────────────────────────────

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error("❌ GITHUB_TOKEN is required");
  process.exit(1);
}

// 从 git remote 推断 owner/repo
function getRepoSlug() {
  const remote = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
  // https://github.com/owner/repo.git or git@github.com:owner/repo.git
  const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
  if (!match) {
    console.error("❌ Cannot parse repo from git remote:", remote);
    process.exit(1);
  }
  return match[1];
}

const REPO_SLUG = getRepoSlug();
const API_BASE = "https://api.github.com";

// ── GitHub API helpers ───────────────────────────────────

async function github(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`GitHub API ${res.status}: ${url} — ${text.slice(0, 200)}`);
    return null;
  }
  return res.json();
}

// ── 依赖仓库映射 ─────────────────────────────────────────

// npm view {pkg} repository.url 可能返回 null，硬编码 fallback
const REPO_MAP = {
  "@anthropic-ai/claude-agent-sdk": "anthropics/claude-agent-sdk-typescript",
  "@larksuiteoapi/node-sdk": "larksuite/node-sdk",
  "chalk": "chalk/chalk",
  "commander": "tj/commander.js",
  "js-yaml": "nodeca/js-yaml",
  "@types/js-yaml": "DefinitelyTyped/DefinitelyTyped",
  "@types/node": "DefinitelyTyped/DefinitelyTyped",
  "semver": "npm/node-semver",
  "tsx": "privatenumber/tsx",
  "typescript": "microsoft/TypeScript",
};

function getRepoSlugForPkg(pkg) {
  if (REPO_MAP[pkg]) return REPO_MAP[pkg];
  // 尝试从 npm view 获取
  try {
    const raw = execSync(`npm view ${pkg} repository.url --json 2>/dev/null`, { encoding: "utf-8" }).trim();
    const url = JSON.parse(raw);
    const match = url?.match(/[:/]([^/]+\/[^/.]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

// ── 获取版本信息 ──────────────────────────────────────────

function getInstalledVersion(pkg) {
  try {
    const pkgJson = JSON.parse(readFileSync(resolve(ROOT, "node_modules", pkg, "package.json"), "utf-8"));
    return pkgJson.version;
  } catch {
    return null;
  }
}

function getLatestVersion(pkg) {
  try {
    const raw = execSync(`npm view ${pkg} version 2>/dev/null`, { encoding: "utf-8" }).trim();
    return raw || null;
  } catch {
    return null;
  }
}

function getBumpType(current, latest) {
  // 简单的版本比较: major.minor.patch
  const c = current.split(".").map(Number);
  const l = latest.split(".").map(Number);
  if (c[0] !== l[0]) return "major";
  if (c[1] !== l[1]) return "minor";
  return "patch";
}

// ── 获取 Release Notes ───────────────────────────────────

async function getReleaseNotes(pkgRepo) {
  if (!pkgRepo) return null;
  const releases = await github(`/repos/${pkgRepo}/releases?per_page=5`);
  if (!releases || releases.length === 0) return null;

  // 合并最近 5 条 release 的 body，截取到 3000 字
  const notes = releases
    .filter((r) => r.body)
    .map((r) => `## ${r.tag_name}\n${r.body}`)
    .join("\n\n---\n\n");

  return notes.length > 3000 ? notes.slice(0, 3000) + "\n\n... (truncated)" : notes;
}

// ── 查找 larkcc 中使用该依赖的文件 ──────────────────────

function findUsageInCode(pkg) {
  try {
    // 搜索 import/require 语句
    const pattern = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const output = execSync(
      `grep -r --include="*.ts" --include="*.js" -l "${pattern}" ${ROOT}/src/ 2>/dev/null || true`,
      { encoding: "utf-8" }
    ).trim();
    if (!output) return [];
    return output
      .split("\n")
      .filter(Boolean)
      .map((f) => f.replace(ROOT + "/", ""));
  } catch {
    return [];
  }
}

// ── Issue 管理 ────────────────────────────────────────────

async function findExistingIssue(pkg) {
  const issues = await github(
    `/repos/${REPO_SLUG}/issues?state=open&labels=deps-update&per_page=50`
  );
  if (!issues) return null;
  const prefix = `deps: ${pkg}`;
  return issues.find((i) => i.title.startsWith(prefix));
}

async function closeIssue(issueNumber) {
  await github(`/repos/${REPO_SLUG}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed" }),
  });
  console.log(`  🔒 Closed old issue #${issueNumber}`);
}

async function createIssue(pkg, current, latest, bumpType, notes, usageFiles) {
  const pkgRepo = getRepoSlugForPkg(pkg);
  const changelogUrl = pkgRepo
    ? `https://github.com/${pkgRepo}/releases`
    : `https://www.npmjs.com/package/${pkg}`;

  const usageSection =
    usageFiles.length > 0
      ? `### larkcc 使用情况\n\n\`\`\`\n${usageFiles.join("\n")}\n\`\`\``
      : "### larkcc 使用情况\n\n该依赖仅在构建/开发时使用，无直接源码引用。";

  const notesSection = notes
    ? `### Release Notes\n\n${notes}`
    : "### Release Notes\n\n未能自动获取，请手动查看上方 Changelog 链接。";

  const body = [
    `## ${pkg}`,
    "",
    `**当前版本**: ${current} → **最新版本**: ${latest}`,
    `**升级类型**: ${bumpType}`,
    `**Changelog**: ${changelogUrl}`,
    "",
    notesSection,
    "",
    usageSection,
    "",
    "### 适配 Checklist",
    "",
    "- [ ] 阅读 Release Notes，标记 breaking changes",
    `- [ ] 更新依赖: \`pnpm add ${pkg}@${latest}\``,
    "- [ ] 适配 larkcc 代码",
    "- [ ] `pnpm build` 验证编译通过",
    "- [ ] install + 冒烟测试",
  ].join("\n");

  const result = await github(`/repos/${REPO_SLUG}/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: `deps: ${pkg} ${current} → ${latest}`,
      body,
      labels: ["deps-update"],
    }),
  });

  if (result) {
    console.log(`  ✅ Created issue #${result.number}: ${result.title}`);
  }
}

// ── 主流程 ────────────────────────────────────────────────

async function main() {
  console.log(`🔍 Checking dependencies for ${REPO_SLUG}...\n`);

  const pkgJson = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
  const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

  const upgradable = [];

  for (const [pkg] of Object.entries(deps)) {
    const current = getInstalledVersion(pkg);
    const latest = getLatestVersion(pkg);

    if (!current || !latest) continue;
    if (current === latest) continue;

    const bumpType = getBumpType(current, latest);
    // 核心依赖任何升级都报，其他依赖跳过 patch
    const isCore = pkg === "@anthropic-ai/claude-agent-sdk" || pkg === "@larksuiteoapi/node-sdk";
    if (bumpType === "patch" && !isCore) {
      console.log(`  ⏭  ${pkg}: ${current} → ${latest} (patch, skipped)`);
      continue;
    }

    console.log(`  📦 ${pkg}: ${current} → ${latest} (${bumpType})`);
    upgradable.push({ pkg, current, latest, bumpType });
  }

  if (upgradable.length === 0) {
    console.log("\n✅ All dependencies up to date (major/minor).");
    return;
  }

  console.log(`\n📝 Creating issues for ${upgradable.length} upgrade(s)...\n`);

  for (const { pkg, current, latest, bumpType } of upgradable) {
    // 获取 release notes（并发可以优化，但数量不多，串行够用）
    const pkgRepo = getRepoSlugForPkg(pkg);
    const notes = await getReleaseNotes(pkgRepo);
    const usageFiles = findUsageInCode(pkg);

    // 关闭已有 Issue
    const existing = await findExistingIssue(pkg);
    if (existing) {
      await closeIssue(existing.number);
    }

    // 创建新 Issue
    await createIssue(pkg, current, latest, bumpType, notes, usageFiles);
  }

  console.log("\n✅ Done.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
