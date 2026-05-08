import * as lark from "@larksuiteoapi/node-sdk";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import { execSync } from "child_process";
import { createLarkClient, createWSClient } from "./feishu.js";
import { LarkccConfig } from "./config.js";
import { buildStatusCard } from "./format/card.js";
import { CommandContext } from "./commands.js";
import { getSession, setSession, getChatId } from "./session.js";
import { logger } from "./logger.js";
import { VERSION } from "./version.js";
import { createMessageHandler } from "./message-handler.js";

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const LOCK_DIR = path.join(os.homedir(), ".larkcc");

interface LockData { pid: number; cwd: string; startedAt: string; continue: boolean; }

function lockPath(profile?: string): string {
  return path.join(LOCK_DIR, profile ? `lock-${profile}.json` : "lock-default.json");
}

function readLock(profile?: string): LockData | null {
  try {
    const p = lockPath(profile);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { return null; }
}

function writeLock(cwd: string, profile: string | undefined, isContinue: boolean): void {
  if (!fs.existsSync(LOCK_DIR)) fs.mkdirSync(LOCK_DIR, { recursive: true });
  fs.writeFileSync(lockPath(profile), JSON.stringify({ pid: process.pid, cwd, startedAt: new Date().toISOString(), continue: isContinue }, null, 2), "utf8");
}

function clearLock(profile?: string): void {
  try { fs.unlinkSync(lockPath(profile)); } catch {}
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function checkLock(cwd: string, profile?: string, force = false): Promise<void> {
  const lock = readLock(profile);
  if (!lock) return;
  if (!isProcessAlive(lock.pid)) { clearLock(profile); return; }
  if (lock.cwd === cwd && lock.pid === process.pid) return;

  const profileLabel = profile ? `[${profile}] ` : "";
  const profileName = profile ?? "default";
  logger.warn(`${profileLabel}Already running!`);
  logger.warn(`  PID: ${lock.pid}`);
  logger.warn(`  Project: ${lock.cwd}`);
  logger.warn(`  Started: ${lock.startedAt}`);

  if (!force) {
    console.log("");
    const answer = await new Promise<string>((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question("  Continue anyway? (y/n): ", (a) => { rl.close(); resolve(a.trim().toLowerCase()); });
    });
    if (answer !== "y") { logger.info("Aborted."); process.exit(0); }
  }

  logger.info(`Terminating existing process (PID: ${lock.pid})...`);
  const result = killProcess(lock.pid, profileName);
  if (!result.success) {
    logger.error(`Failed to terminate (PID: ${lock.pid}): ${result.error}`);
    process.exit(1);
  }
}

export interface RunningProcess {
  profile: string;
  pid: number;
  cwd: string;
  startedAt: string;
  isContinue: boolean;
  alive: boolean;
}

export function listRunningProcesses(): { processes: RunningProcess[]; cleaned: string[] } {
  const processes: RunningProcess[] = [];
  const cleaned: string[] = [];

  if (!fs.existsSync(LOCK_DIR)) return { processes, cleaned };

  const files = fs.readdirSync(LOCK_DIR).filter(f => f.startsWith("lock-") && f.endsWith(".json"));

  for (const file of files) {
    const match = file.match(/^lock-(.+)\.json$/);
    if (!match) continue;

    const profile = match[1];
    const lock = readLock(profile);
    if (!lock) continue;

    const alive = isProcessAlive(lock.pid);

    if (!alive) {
      clearLock(profile);
      cleaned.push(profile);
      continue;
    }

    processes.push({
      profile,
      pid: lock.pid,
      cwd: lock.cwd,
      startedAt: lock.startedAt,
      isContinue: lock.continue ?? false,
      alive,
    });
  }

  processes.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  return { processes, cleaned };
}

export function killProcess(pid: number, profile: string): { success: boolean; error?: string } {
  try {
    console.log(chalk.cyan(`⏳ 发送 SIGTERM...`));
    process.kill(pid, "SIGTERM");

    let waited = 0;
    const maxWait = 3000;
    const checkInterval = 100;

    while (waited < maxWait) {
      const alive = isProcessAlive(pid);
      if (!alive) {
        console.log(chalk.green(`✅ 进程已终止`));
        clearLock(profile);
        return { success: true };
      }
      waited += checkInterval;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, checkInterval);
    }

    console.log(chalk.yellow(`⏳ 进程未响应，发送 SIGKILL...`));
    process.kill(pid, "SIGKILL");

    waited = 0;
    while (waited < 1000) {
      const alive = isProcessAlive(pid);
      if (!alive) {
        console.log(chalk.green(`✅ 进程已强制终止`));
        clearLock(profile);
        return { success: true };
      }
      waited += checkInterval;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, checkInterval);
    }

    return { success: false, error: "进程无法终止" };
  } catch (err) {
    const errorMsg = String(err);
    clearLock(profile);
    return { success: false, error: errorMsg };
  }
}

export function killAllProcesses(processes: RunningProcess[]): { killed: number; failed: number } {
  let killed = 0;
  let failed = 0;

  for (const p of processes) {
    console.log(chalk.cyan(`⏳ 终止 ${p.profile} (PID: ${p.pid})...`));
    const result = killProcess(p.pid, p.profile);
    if (result.success) {
      killed++;
    } else {
      failed++;
      console.log(chalk.red(`   ❌ 失败: ${result.error}`));
    }
  }

  return { killed, failed };
}

function injectClaudeEnv(): void {
  try {
    if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return;
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, "utf8"));
    const env = settings?.env ?? {};
    for (const [key, value] of Object.entries(env)) {
      if (!process.env[key]) process.env[key] = String(value);
    }
    logger.dim(`injected ${Object.keys(env).length} env vars from ~/.claude/settings.json`);
  } catch (err) { logger.warn(`Failed to read ~/.claude/settings.json: ${String(err)}`); }
}

function ensureClaudeOnboarding(): void {
  const claudeJsonPath = path.join(os.homedir(), ".claude.json");
  try {
    let json: Record<string, unknown> = {};
    if (fs.existsSync(claudeJsonPath)) json = JSON.parse(fs.readFileSync(claudeJsonPath, "utf8"));
    if (!json.hasCompletedOnboarding) {
      json.hasCompletedOnboarding = true;
      fs.writeFileSync(claudeJsonPath, JSON.stringify(json, null, 2), "utf8");
      logger.dim("wrote hasCompletedOnboarding to ~/.claude.json");
    }
  } catch (err) { logger.warn(`Failed to write ~/.claude.json: ${String(err)}`); }
}

function ensureEnv(): void {
  if (!process.env.HOME) process.env.HOME = os.homedir();
  try {
    const shellPath = execSync("bash -lc 'echo $PATH' 2>/dev/null", { timeout: 3000 }).toString().trim();
    if (shellPath) process.env.PATH = shellPath;
  } catch {}
}

function ensureClaudeInPath(): void {
  const commonPaths = [
    "/usr/local/bin", "/usr/bin",
    `${os.homedir()}/.npm-global/bin`, `${os.homedir()}/.local/bin`,
    "/opt/homebrew/bin", "/home/linuxbrew/.linuxbrew/bin",
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
  continueSession = false,
  force = false
): Promise<void> {
  const { app_id, app_secret } = config.feishu;

  const commandContext: CommandContext = {
    customCommands: (config as any).commands ?? {},
    execCommands: (config as any).exec_commands ?? {},
    execSecurity: (config as any).exec_security ?? { enabled: true, blacklist: [], confirm_on_warning: true },
  };

  await checkLock(cwd, profile, force);
  writeLock(cwd, profile, continueSession);

  injectClaudeEnv();
  ensureClaudeOnboarding();
  ensureEnv();
  ensureClaudeInPath();

  const client    = createLarkClient(app_id, app_secret);
  const wsClient  = createWSClient(app_id, app_secret);

  // 获取机器人自己的 open_id
  let botOpenId = "";
  try {
    const botInfo = await (client as any).bot.getBotInfo({});
    botOpenId = (botInfo as any).data?.open_id ?? "";
    if (botOpenId) logger.dim(`bot open_id: ${botOpenId}`);
  } catch {}

  const startupTime = Date.now();

  if (continueSession) {
    const savedSession = getSession(true);
    if (savedSession) { setSession(savedSession); logger.info(`Resuming session: ${savedSession}`); }
    else logger.warn("No saved session found, starting fresh");
  }

  const profileLabel = profile ? ` [${profile}]` : "";
  logger.info(`Project:  ${cwd}`);
  logger.info(`Profile:  ${profile ?? "default"}`);
  logger.info(`AppID:    ${app_id}`);
  logger.info(`Owner:    ${config.feishu.owner_open_id || "(pending first message)"}`);
  logger.info(`Session:  ${continueSession ? "continue" : "new"}`);
  logger.info("Connecting to Feishu...");

  const handler = createMessageHandler({
    client,
    config,
    profile,
    cwd,
    botOpenId,
    startupTime,
    commandContext,
  });

  wsClient.start({
    eventDispatcher: new lark.EventDispatcher({}).register({
      "im.message.receive_v1": handler,
    }),
  });

  logger.success("Feishu connected! Waiting for messages...");
  logger.dim("Press Ctrl+C to stop\n");

  const knownChatId = getChatId();
  if (knownChatId && config.feishu.owner_open_id) {
    const sessionNote = continueSession ? "续接上次对话" : "新会话";
    const tags: Array<{ text: string; color: string }> = [];
    if (profileLabel) tags.push({ text: profileLabel, color: "purple" });
    tags.push({ text: sessionNote, color: "turquoise" });
    const card = buildStatusCard({
      title: "larkcc",
      bodyLines: [
        "**已上线** — 随时可以对话",
        "",
        `📁 \`${cwd}\``,
      ],
      template: "green",
      tags,
      footer: `v${VERSION}`,
    });
    try {
      await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: knownChatId,
          msg_type: "interactive",
          content: JSON.stringify(card),
        },
      });
    } catch (e) {
      logger.warn(`Startup notification failed: ${e}`);
    }
  } else {
    logger.dim("No chat_id yet — send any message to the bot first");
  }

  const shutdown = async () => {
    console.log("");
    logger.info("Stopping larkcc...");
    clearLock(profile);
    const chatId = getChatId();
    if (chatId) {
      try {
        const tags: Array<{ text: string; color: string }> = [];
        if (profileLabel) tags.push({ text: profileLabel, color: "purple" });
        const card = buildStatusCard({
          title: "larkcc",
          bodyLines: [
            "**已离线**",
            "",
            `📁 \`${cwd}\``,
          ],
          template: "red",
          tags,
          footer: `v${VERSION}`,
        });
        await client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: chatId,
            msg_type: "interactive",
            content: JSON.stringify(card),
          },
        });
      } catch {}
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
