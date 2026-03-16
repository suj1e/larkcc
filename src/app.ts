import * as lark from "@larksuiteoapi/node-sdk";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { createLarkClient, createWSClient, sendText } from "./feishu.js";
import { runAgent, ensureEnv } from "./agent.js";
import { LarkccConfig } from "./config.js";
import { getSession, setSession } from "./session.js";
import { logger } from "./logger.js";

const STATE_PATH = path.join(os.homedir(), ".larkcc", "state.json");
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

// 从 ~/.claude/settings.json 注入 env 块，确保子进程继承认证配置
function injectClaudeEnv(): void {
  try {
    if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return;
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, "utf8"));
    const env = settings?.env ?? {};
    for (const [key, value] of Object.entries(env)) {
      if (!process.env[key]) {
        process.env[key] = String(value);
      }
    }
    logger.dim(`injected ${Object.keys(env).length} env vars from ~/.claude/settings.json`);
  } catch (err) {
    logger.warn(`Failed to read ~/.claude/settings.json: ${String(err)}`);
  }
}

// 确保 ~/.claude.json 存在且包含 hasCompletedOnboarding，避免 claude 卡在引导流程
function ensureClaudeOnboarding(): void {
  const claudeJsonPath = path.join(os.homedir(), ".claude.json");
  try {
    let json: Record<string, unknown> = {};
    if (fs.existsSync(claudeJsonPath)) {
      json = JSON.parse(fs.readFileSync(claudeJsonPath, "utf8"));
    }
    if (!json.hasCompletedOnboarding) {
      json.hasCompletedOnboarding = true;
      fs.writeFileSync(claudeJsonPath, JSON.stringify(json, null, 2), "utf8");
      logger.dim("wrote hasCompletedOnboarding to ~/.claude.json");
    }
  } catch (err) {
    logger.warn(`Failed to write ~/.claude.json: ${String(err)}`);
  }
}

// 自动探测 claude 路径，补进 PATH 让 SDK 子进程能找到
function ensureClaudeInPath(): void {
  const commonPaths = [
    "/usr/local/bin",
    "/usr/bin",
    `${os.homedir()}/.npm-global/bin`,
    `${os.homedir()}/.local/bin`,
    "/opt/homebrew/bin",
    "/home/linuxbrew/.linuxbrew/bin",
  ];

  // 先用 shell which 探测（最准，能读到用户的完整 PATH）
  try {
    const claudePath = execSync("which claude 2>/dev/null || command -v claude 2>/dev/null", {
      shell: "/bin/bash",
      env: { ...process.env, PATH: [...commonPaths, process.env.PATH ?? ""].join(":") },
    }).toString().trim();

    if (claudePath) {
      const dir = path.dirname(claudePath);
      if (!process.env.PATH?.includes(dir)) {
        process.env.PATH = `${dir}:${process.env.PATH}`;
      }
      logger.dim(`claude found: ${claudePath}`);
      return;
    }
  } catch {}

  // fallback：扫常见目录
  for (const dir of commonPaths) {
    if (fs.existsSync(path.join(dir, "claude"))) {
      if (!process.env.PATH?.includes(dir)) {
        process.env.PATH = `${dir}:${process.env.PATH}`;
      }
      logger.dim(`claude found: ${dir}/claude`);
      return;
    }
  }

  logger.warn("claude CLI not found — make sure it's installed: npm install -g @anthropic-ai/claude-code");
}

// ── 持久化 chat_id ────────────────────────────────────────────

function loadChatId(): string | null {
  try {
    if (!fs.existsSync(STATE_PATH)) return null;
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")).chat_id ?? null;
  } catch {
    return null;
  }
}

function saveChatId(chatId: string): void {
  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let state: Record<string, string> = {};
  try { state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch {}
  state.chat_id = chatId;
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

// ── 主逻辑 ────────────────────────────────────────────────────

export async function startApp(
  cwd: string,
  config: LarkccConfig,
  continueSession = false
): Promise<void> {
  const { app_id, app_secret, owner_open_id } = config.feishu;

  // 启动时自动找 claude
  injectClaudeEnv();
  ensureClaudeOnboarding();
  ensureEnv();
  ensureClaudeInPath();

  const client   = createLarkClient(app_id, app_secret);
  const wsClient = createWSClient(app_id, app_secret);

  let processing  = false;
  let knownChatId = loadChatId();
  const startupTime = Date.now(); // 服务启动时间，忽略启动前的所有消息
  const recentMessages = new Map<string, number>(); // key → timestamp，30s 去重

  // --continue：从持久化 session 恢复
  if (continueSession) {
    const savedSession = getSession(true);
    if (savedSession) {
      setSession(savedSession);
      logger.info(`Resuming session: ${savedSession}`);
    } else {
      logger.warn("No saved session found, starting fresh");
    }
  }

  logger.info(`Project:  ${cwd}`);
  logger.info(`AppID:    ${app_id}`);
  logger.info(`Owner:    ${owner_open_id}`);
  logger.info(`Session:  ${continueSession ? "continue" : "new"}`);
  logger.info("Connecting to Feishu...");

  wsClient.start({
    eventDispatcher: new lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data) => {
        const msg      = data.message;
        const senderId = data.sender.sender_id?.open_id ?? "";

        if (!["text", "post"].includes(msg.message_type)) return;

        // 忽略启动前的消息（长连接重连后会重推历史未 ACK 消息）
        const msgTimestamp = Number(msg.create_time);
        const now = Date.now();
        if (msgTimestamp < startupTime) {
          logger.dim(`skipped pre-startup message (${Math.round((now - msgTimestamp) / 1000)}s ago)`);
          return;
        }

        // 去重：30s 内相同发送者+内容只处理一次（防飞书重试）
        const dedupeKey = `${senderId}:${msg.message_id}`;
        const lastSeen = recentMessages.get(dedupeKey);
        if (lastSeen && now - lastSeen < 30_000) return;
        recentMessages.set(dedupeKey, now);
        // 清理过期记录
        for (const [k, t] of recentMessages) {
          if (now - t > 30_000) recentMessages.delete(k);
        }

        if (senderId !== owner_open_id) {
          logger.warn(`Ignored message from unknown user: ${senderId}`);
          logger.warn(`  👆 If this is you, run: larkcc --setup and enter this open_id`);
          return;
        }

        const chatId = msg.chat_id;
        // 解析消息内容：text 直接取，post（富文本）提取纯文字
        let text = "";
        // 剥离 HTML 标签的辅助函数
        const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "").trim();

        if (msg.message_type === "text") {
          text = stripHtml((JSON.parse(msg.content) as { text?: string }).text ?? "");
        } else if (msg.message_type === "post") {
          // post 结构：{ title, content } 或 { zh_cn: { title, content } }
          const raw = JSON.parse(msg.content);
          const post = raw.zh_cn ?? raw;
          const title = stripHtml(post.title ?? "");
          const blocks: Array<Array<{ tag: string; text?: string }>> = post.content ?? [];
          // 每行所有 text 块直接拼接（同一行的序号和文字不换行）
          const lines = blocks.map(line =>
            line.map(el => stripHtml(el.text ?? "")).join("").trim()
          ).filter(Boolean);
          const body = lines.join("\n").trim();
          text = [title, body].filter(Boolean).join("\n").trim();
        }
        if (!text) return;

        // 首次收到消息，记住 chat_id
        if (!knownChatId || knownChatId !== chatId) {
          knownChatId = chatId;
          saveChatId(chatId);
          logger.dim(`chat_id saved: ${chatId}`);
        }

        logger.msg(senderId, text);

        if (processing) {
          logger.warn("Still processing previous message, skipping...");
          await sendText(client, chatId, "⏳ 上一条消息还在处理中，请稍候...");
          return;
        }

        processing = true;

        // 收到消息，先加 👀 reaction 表示处理中
        let reactionId: string | undefined;
        try {
          const reactionRes = await client.im.messageReaction.create({
            path: { message_id: msg.message_id },
            data: { reaction_type: { emoji_type: "OK" } },
          });
          reactionId = reactionRes.data?.reaction_id;
        } catch {}

        try {
          await runAgent(text, cwd, config, client, chatId, msg.message_id);
          // 回复完成，换成 ✅ reaction
          if (reactionId) {
            await client.im.messageReaction.delete({
              path: { message_id: msg.message_id, reaction_id: reactionId },
            }).catch(() => {});
          }
          await client.im.messageReaction.create({
            path: { message_id: msg.message_id },
            data: { reaction_type: { emoji_type: "DONE" } },
          }).catch(() => {});
        } catch (err) {
          logger.error(`Agent error: ${String(err)}`);
          await sendText(client, chatId, `❌ 出错了：${String(err)}`);
          // 出错，换成 ❌ reaction
          if (reactionId) {
            await client.im.messageReaction.delete({
              path: { message_id: msg.message_id, reaction_id: reactionId },
            }).catch(() => {});
          }
          await client.im.messageReaction.create({
            path: { message_id: msg.message_id },
            data: { reaction_type: { emoji_type: "OnIt" } },
          }).catch(() => {});
        } finally {
          processing = false;
        }
      },
    }),
  });

  logger.success("Feishu connected! Waiting for messages...");
  logger.dim("Press Ctrl+C to stop\n");

  if (knownChatId) {
    const sessionNote = continueSession ? "（续接上次对话）" : "（新会话）";
    await sendText(client, knownChatId, `✅ larkcc 已连接 ${sessionNote}\n📁 当前项目：\`${cwd}\``);
  } else {
    logger.dim("No chat_id yet — send any message to the bot first");
  }

  // 优雅退出
  const shutdown = async () => {
    console.log("");
    logger.info("Stopping larkcc...");
    if (knownChatId) {
      try {
        await sendText(client, knownChatId, `👋 larkcc 已断开\n📁 项目：\`${cwd}\``);
      } catch {}
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}