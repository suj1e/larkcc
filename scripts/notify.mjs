#!/usr/bin/env node

/**
 * Feishu Notify — 统一通知脚本
 *
 * 场景：daily-digest / issue / PR / comment
 * 零外部依赖，使用 Node 18 内置 fetch + child_process
 *
 * 安全设计：所有用户输入（Issue body、标题、label）均通过
 * $GITHUB_EVENT_PATH JSON 文件读取，不经 shell 解析，杜绝注入。
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const WEBHOOK = process.env.FEISHU_WEBHOOK;
const EVENT = process.env.GITHUB_EVENT_NAME;
const REPO = process.env.GITHUB_REPOSITORY;
const ACTOR = process.env.GITHUB_ACTOR;
const payload = JSON.parse(
  readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
);

// ── Helpers ──────────────────────────────────────────

function truncate(str, max = 300) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;
}

async function sendCard(card) {
  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msg_type: "interactive", card }),
  });
  const text = await res.text();
  console.log(`Webhook response: ${res.status} ${text}`);
}

function ghJSON(args) {
  return JSON.parse(execSync(`gh ${args}`, { encoding: "utf8" }));
}

// ── 每日巡检 ─────────────────────────────────────────

async function dailyDigest() {
  const [manual, deps, prs] = [
    ghJSON(
      `issue list -R ${REPO} --state open --json number,title,labels --jq '[.[] | select([.labels[].name] | inside(["deps-update"]) | not)]'`,
    ),
    ghJSON(
      `issue list -R ${REPO} --state open --label deps-update --json number,title`,
    ),
    ghJSON(`pr list -R ${REPO} --state open --json number,title`),
  ];

  const total = manual.length + deps.length + prs.length;

  if (total === 0) {
    return sendCard({
      header: {
        title: { tag: "plain_text", content: "📊 larkcc 每日巡检" },
        template: "green",
      },
      elements: [
        {
          tag: "div",
          text: { tag: "lark_md", content: "✅ 无未处理事项，一切正常！" },
        },
      ],
    });
  }

  const elements = [];

  if (manual.length > 0) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `📌 **待处理 Issue:** ${manual.length} 个`,
      },
    });
    for (const i of manual.slice(0, 5)) {
      const labels = i.labels?.map((l) => l.name).join(", ") || "";
      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `   - #${i.number} ${i.title} (${labels})`,
        },
      });
    }
  }

  if (deps.length > 0) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `📦 **待适配依赖更新:** ${deps.length} 个`,
      },
    });
    for (const d of deps.slice(0, 5)) {
      elements.push({
        tag: "div",
        text: { tag: "lark_md", content: `   - #${d.number} ${d.title}` },
      });
    }
  }

  if (prs.length > 0) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `🔀 **待处理 PR:** ${prs.length} 个`,
      },
    });
    for (const p of prs.slice(0, 5)) {
      elements.push({
        tag: "div",
        text: { tag: "lark_md", content: `   - #${p.number} ${p.title}` },
      });
    }
  }

  return sendCard({
    header: {
      title: { tag: "plain_text", content: "📊 larkcc 每日巡检" },
      template: "blue",
    },
    elements,
  });
}

// ── Issue 通知 ───────────────────────────────────────

async function issueNotify() {
  const { issue } = payload;
  const labels = issue.labels?.map((l) => l.name).join(", ") || "";
  const summary = truncate(issue.body);

  return sendCard({
    header: {
      title: {
        tag: "plain_text",
        content: `📌 新 Issue #${issue.number}: ${issue.title}`,
      },
      template: "blue",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**标签:** ${labels}\n**提交者:** ${ACTOR}`,
        },
      },
      { tag: "div", text: { tag: "lark_md", content: summary } },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "🔗 查看详情" },
            url: issue.html_url,
            type: "primary",
          },
        ],
      },
    ],
  });
}

// ── PR 通知 ──────────────────────────────────────────

async function prNotify() {
  const pr = payload.pull_request;
  const summary = truncate(pr.body);

  return sendCard({
    header: {
      title: {
        tag: "plain_text",
        content: `🔀 新 PR #${pr.number}: ${pr.title}`,
      },
      template: "purple",
    },
    elements: [
      {
        tag: "div",
        text: { tag: "lark_md", content: `**提交者:** ${ACTOR}` },
      },
      { tag: "div", text: { tag: "lark_md", content: summary } },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "🔗 查看详情" },
            url: pr.html_url,
            type: "primary",
          },
        ],
      },
    ],
  });
}

// ── 评论通知 ─────────────────────────────────────────

async function commentNotify() {
  if (ACTOR.endsWith("[bot]")) return;

  const { issue, comment } = payload;
  const type = issue.pull_request ? "PR" : "Issue";
  const summary = truncate(comment.body);

  return sendCard({
    header: {
      title: {
        tag: "plain_text",
        content: `💬 新评论 on ${type} #${issue.number} ${issue.title}`,
      },
      template: "cyan",
    },
    elements: [
      {
        tag: "div",
        text: { tag: "lark_md", content: `**评论者:** ${ACTOR}` },
      },
      { tag: "div", text: { tag: "lark_md", content: summary } },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "🔗 查看详情" },
            url: comment.html_url,
            type: "primary",
          },
        ],
      },
    ],
  });
}

// ── 分发 ─────────────────────────────────────────────

const handlers = {
  schedule: dailyDigest,
  workflow_dispatch: dailyDigest,
  issues: issueNotify,
  pull_request: prNotify,
  issue_comment: commentNotify,
};

const handler = handlers[EVENT];
if (handler) {
  await handler();
} else {
  console.log(`No handler for event: ${EVENT}`);
}
