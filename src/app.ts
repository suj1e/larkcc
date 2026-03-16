import * as lark from "@larksuiteoapi/node-sdk";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { createLarkClient, createWSClient, sendText } from "./feishu.js";
import { runAgent, ensureEnv } from "./agent.js";
import { LarkccConfig, saveOwnerOpenId } from "./config.js";
import { getSession, setSession, getChatId, saveChatId } from "./session.js";
import { logger } from "./logger.js";
import readline from "readline";

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const LOCK_DIR = path.join(os.homedir(), ".larkcc");

interface LockData {
  pid: number;
  cwd: string;
  startedAt: string;
}

function lockPath(profile?: string): string {
  const name = profile ? `lock-${profile}` : "lock-default";
  return path.join(LOCK_DIR, `${name}.json`);
}

function readLock(profile?: string): LockData | null {
  try {
    const p = lockPath(profile);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeLock(cwd: string, profile?: string): void {
  if (!fs.existsSync(LOCK_DIR)) fs.mkdirSync(LOCK_DIR, { recursive: true });
  const data: LockData = { pid: process.pid, cwd, startedAt: new Date().toISOString() };
  fs.writeFileSync(lockPath(profile), JSON.stringify(data, null, 2), "utf8");
}

function clearLock(profile?: string): void {
  try { fs.unlinkSync(lockPath(profile)); } catch {}
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function checkLock(cwd: string, profile?: string): Promise<boolean> {
  const lock = readLock(profile);
  if (!lock) return true;

  if (!isProcessAlive(lock.pid)) {
    clearLock(profile);
    return true;
  }

  // 同一目录同一进程，允许（重启场景）
  if (lock.cwd === cwd && lock.pid === process.pid) return true;

  const profileLabel = profile ? `[${profile}] ` : "";
  logger.warn(`${profileLabel}Already running!`);
  logger.warn(`  PID: ${lock.pid}`);
  logger.warn(`  Project: ${lock.cwd}`);
  logger.warn(`  Started: ${lock.startedAt}`);
  console.log("");

  const answer = await new Promise<string>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("  Continue anyway? (y/n): ", (a) => { rl.close(); resolve(a.trim().toLowerCase()); });
  });

  if (answer !== "y") {
    logger.info("Aborted.");
    process.exit(0);
  }

  clearLock(profile);
  return true;
}

// 从 ~/.claude/settings.json 注入 env 块
function injectClaudeEnv(): void {
  try {
    if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return;
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, "utf8"));
    const env = settings?.env ?? {};
    for (const [key, value] of Object.entries(env)) {
      if (!process.env[key]) process.env[key] = String(value);
    }
    logger.dim(`injected ${Object.keys(env).length} env vars from ~/.claude/settings.json`);
  } catch (err) {
    logger.warn(`Failed to read ~/.claude/settings.json: ${String(err)}`);
  }
}

// 确保 ~/.claude.json 有 hasCompletedOnboarding
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

// 自动探测 claude 路径
function ensureClaudeInPath(): void {
  const commonPaths = [
    "/usr/local/bin",
    "/usr/bin",
    `${os.homedir()}/.npm-global/bin`,
    `${os.homedir()}/.local/bin`,
    "/opt/homebrew/bin",
    "/home/linuxbrew/.linuxbrew/bin",
  ];

  try {
    const claudePath = execSync("which claude 2>/dev/null || command -v claude 2>/dev/null", {
      shell: "/bin/bash",
      env: { ...process.env, PATH: [...commonPaths, process.env.PATH ?? ""].join(":") },
    }).toString().trim();

    if (claudePath) {
      const dir = path.dirname(claudePath);
      if (!process.env.PATH?.includes(dir)) process.env.PATH = `${dir}:${process.env.PATH}`;
      logger.dim(`claude found: ${claudePath}`);
      return;
    }
  } catch {}

  for (const dir of commonPaths) {
    if (fs.existsSync(path.join(dir, "claude"))) {
      if (!process.env.PATH?.includes(dir)) process.env.PATH = `${dir}:${process.env.PATH}`;
      logger.dim(`claude found: ${dir}/claude`);
      return;
    }
  }

  logger.warn("claude CLI not found — make sure it's installed: npm install -g @anthropic-ai/claude-code");
}

// ── 主逻辑 ────────────────────────────────────────────────────

export async function startApp(
  cwd: string,
  config: LarkccConfig,
  profile: string | undefined,
  continueSession = false
): Promise<void> {
  const { app_id, app_secret } = config.feishu;
  // owner_open_id 可能在运行时自动填入，直接读 config.feishu
  const getOwnerOpenId = () => config.feishu.owner_open_id;

  // 检测是否已有同 profile 的进程在运行
  await checkLock(cwd, profile);
  writeLock(cwd, profile);

  injectClaudeEnv();
  ensureClaudeOnboarding();
  ensureEnv();
  ensureClaudeInPath();

  const client   = createLarkClient(app_id, app_secret);
  const wsClient = createWSClient(app_id, app_secret);

  let processing  = false;
  let knownChatId = getChatId();
  const startupTime = Date.now();
  const recentMessages = new Map<string, number>();

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

  const profileLabel = profile ? ` [${profile}]` : "";
  logger.info(`Project:  ${cwd}`);
  logger.info(`Profile:  ${profile ?? "default"}`);
  logger.info(`AppID:    ${app_id}`);
  logger.info(`Owner:    ${getOwnerOpenId() || "(pending first message)"}`);
  logger.info(`Session:  ${continueSession ? "continue" : "new"}`);
  logger.info("Connecting to Feishu...");

  wsClient.start({
    eventDispatcher: new lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data) => {
        const msg      = data.message;
        const senderId = data.sender.sender_id?.open_id ?? "";

        if (!["text", "post"].includes(msg.message_type)) return;

        // 忽略启动前的消息
        const msgTimestamp = Number(msg.create_time);
        const now = Date.now();
        if (msgTimestamp < startupTime) {
          logger.dim(`skipped pre-startup message (${Math.round((now - msgTimestamp) / 1000)}s ago)`);
          return;
        }

        // 去重
        const dedupeKey = `${senderId}:${msg.message_id}`;
        const lastSeen = recentMessages.get(dedupeKey);
        if (lastSeen && now - lastSeen < 30_000) return;
        recentMessages.set(dedupeKey, now);
        for (const [k, t] of recentMessages) {
          if (now - t > 30_000) recentMessages.delete(k);
        }

        // owner_open_id 未配置时，第一条消息自动检测并保存
        const owner_open_id = getOwnerOpenId();
        if (!owner_open_id) {
          logger.success(`Auto-detected open_id: ${senderId}`);
          logger.success(`Saving to config...`);
          saveOwnerOpenId(senderId, profile);
          config.feishu.owner_open_id = senderId;
          // 更新本地变量
          Object.assign(config.feishu, { owner_open_id: senderId });
        } else if (senderId !== owner_open_id) {
          logger.warn(`Ignored message from unknown user: ${senderId}`);
          return;
        }

        const chatId = msg.chat_id;

        // 解析消息内容
        const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "").trim();
        let text = "";
        if (msg.message_type === "text") {
          text = stripHtml((JSON.parse(msg.content) as { text?: string }).text ?? "");
        } else if (msg.message_type === "post") {
          const raw = JSON.parse(msg.content);
          const post = raw.zh_cn ?? raw;
          const title = stripHtml(post.title ?? "");
          const blocks: Array<Array<{ tag: string; text?: string }>> = post.content ?? [];
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

        // Reaction: 处理中
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
    await sendText(client, knownChatId, `✅ larkcc 已连接${profileLabel} ${sessionNote}\n📁 当前项目：\`${cwd}\``);
  } else {
    logger.dim("No chat_id yet — send any message to the bot first");
  }

  const shutdown = async () => {
    console.log("");
    logger.info("Stopping larkcc...");
    clearLock(profile);
    if (knownChatId) {
      try {
        await sendText(client, knownChatId, `👋 larkcc 已断开${profileLabel}\n📁 项目：\`${cwd}\``);
      } catch {}
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}