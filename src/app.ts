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
  ensureEnv();
  ensureClaudeInPath();

  const client   = createLarkClient(app_id, app_secret);
  const wsClient = createWSClient(app_id, app_secret);

  let processing  = false;
  let knownChatId = loadChatId();

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

        if (msg.message_type !== "text") return;

        if (senderId !== owner_open_id) {
          logger.warn(`Ignored message from unknown user: ${senderId}`);
          logger.warn(`  👆 If this is you, run: larkcc --setup and enter this open_id`);
          return;
        }

        const chatId = msg.chat_id;
        const text   = (JSON.parse(msg.content) as { text?: string }).text?.trim();
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
        try {
          await runAgent(text, cwd, config, client, chatId);
        } catch (err) {
          logger.error(`Agent error: ${String(err)}`);
          await sendText(client, chatId, `❌ 出错了：${String(err)}`);
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
