import * as lark from "@larksuiteoapi/node-sdk";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import { execSync } from "child_process";
import { createLarkClient, createWSClient, sendText, downloadImage, downloadFile, DownloadedFile } from "./feishu.js";
import { runAgent, ensureEnv, ImageInput } from "./agent.js";
import { LarkccConfig, saveOwnerOpenId } from "./config.js";
import { parseCommand } from "./commands.js";
import { getSession, setSession, getChatId, saveChatId } from "./session.js";
import { logger } from "./logger.js";
import * as multifile from "./multifile.js";

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

async function checkLock(cwd: string, profile?: string): Promise<void> {
  const lock = readLock(profile);
  if (!lock) return;
  if (!isProcessAlive(lock.pid)) { clearLock(profile); return; }
  if (lock.cwd === cwd && lock.pid === process.pid) return;

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

  if (answer !== "y") { logger.info("Aborted."); process.exit(0); }
  clearLock(profile);
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

  // 按启动时间排序
  processes.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  return { processes, cleaned };
}

/**
 * 终止指定进程
 */
export function killProcess(pid: number, profile: string): { success: boolean; error?: string } {
  try {
    console.log(chalk.cyan(`⏳ 发送 SIGTERM...`));
    process.kill(pid, "SIGTERM");

    // 等待进程终止
    let waited = 0;
    const maxWait = 3000; // 3 秒
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

    // 3 秒后还没终止，发送 SIGKILL
    console.log(chalk.yellow(`⏳ 进程未响应，发送 SIGKILL...`));
    process.kill(pid, "SIGKILL");

    // 再等待 1 秒
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
    clearLock(profile); // 清理锁文件
    return { success: false, error: errorMsg };
  }
}

/**
 * 终止所有进程
 */
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

// 去掉消息里的 @ 提及文字，只保留实际内容
function stripMentions(text: string): string {
  return text.replace(/@\S+/g, "").trim();
}

// ── 主逻辑 ────────────────────────────────────────────────────

export async function startApp(
  cwd: string,
  config: LarkccConfig,
  profile: string | undefined,
  continueSession = false
): Promise<void> {
  const { app_id, app_secret } = config.feishu;
  const getOwnerOpenId = () => config.feishu.owner_open_id;
  const customCommands: Record<string, string> = (config as any).commands ?? {};

  await checkLock(cwd, profile);
  writeLock(cwd, profile, continueSession);

  injectClaudeEnv();
  ensureClaudeOnboarding();
  ensureEnv();
  ensureClaudeInPath();

  const client    = createLarkClient(app_id, app_secret);
  const wsClient  = createWSClient(app_id, app_secret);

  // 获取机器人自己的 open_id，用于群消息 @ 识别
  let botOpenId = "";
  try {
    const botInfo = await (client as any).bot.getBotInfo({});
    botOpenId = (botInfo as any).data?.open_id ?? "";
    if (botOpenId) logger.dim(`bot open_id: ${botOpenId}`);
  } catch {}

  let processing   = false;
  let processingStartedAt = 0;
  let currentAbortController: AbortController | null = null;
  let knownChatId  = getChatId();
  const startupTime    = Date.now();
  const recentMessages = new Map<string, number>();
  const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;

  if (continueSession) {
    const savedSession = getSession(true);
    if (savedSession) { setSession(savedSession); logger.info(`Resuming session: ${savedSession}`); }
    else logger.warn("No saved session found, starting fresh");
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
        const isGroup  = msg.chat_type === "group";

        if (!["text", "post", "image", "file"].includes(msg.message_type)) return;

        const msgTimestamp = Number(msg.create_time);
        const now = Date.now();
        if (msgTimestamp < startupTime) {
          logger.dim(`skipped pre-startup message (${Math.round((now - msgTimestamp) / 1000)}s ago)`);
          return;
        }

        // 群消息：只响应 @ 自己 或 引用了消息（不管引用谁）
        if (isGroup) {
          const mentions: Array<{ id?: { open_id?: string } }> = (msg as any).mentions ?? [];
          const atBot = botOpenId
            ? mentions.some(m => m.id?.open_id === botOpenId)
            : mentions.length > 0; // botOpenId 未知时，有 @ 就响应
          const hasQuote = !!(msg as any).parent_id;
          if (!atBot && !hasQuote) return;
        }

        const dedupeKey = `${senderId}:${msg.message_id}`;
        const lastSeen  = recentMessages.get(dedupeKey);
        if (lastSeen && now - lastSeen < 30_000) return;
        recentMessages.set(dedupeKey, now);
        for (const [k, t] of recentMessages) {
          if (now - t > 30_000) recentMessages.delete(k);
        }

        const owner_open_id = getOwnerOpenId();
        if (!owner_open_id) {
          logger.success(`Auto-detected open_id: ${senderId}`);
          saveOwnerOpenId(senderId, profile);
          config.feishu.owner_open_id = senderId;
        } else if (senderId !== owner_open_id) {
          logger.warn(`Ignored message from unknown user: ${senderId}`);
          return;
        }

        const chatId = msg.chat_id;
        if (!knownChatId || knownChatId !== chatId) {
          knownChatId = chatId;
          saveChatId(chatId);
          logger.dim(`chat_id saved: ${chatId} (${isGroup ? "group" : "p2p"})`);
        }

        // ── 解析消息内容 ──────────────────────────────────────
        const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "").trim();
        let text = "";
        let images: ImageInput[] = [];
        let downloadedFile: DownloadedFile | null = null;

        // 文件处理配置（提前定义，供多处使用）
        const fileConfig = config.file;
        const profileKey = profile ?? "default";

        if (msg.message_type === "text") {
          const raw = stripHtml((JSON.parse(msg.content) as { text?: string }).text ?? "");
          text = isGroup ? stripMentions(raw) : raw;
        } else if (msg.message_type === "post") {
          const raw  = JSON.parse(msg.content);
          const post = raw.zh_cn ?? raw;
          const title  = stripHtml(post.title ?? "");
          const blocks: Array<Array<{ tag: string; text?: string; image_key?: string }>> = post.content ?? [];

          // 提取文字内容
          const lines  = blocks.map(line =>
            line.map(el => stripHtml(el.text ?? "")).join("").trim()
          ).filter(Boolean);
          const body = lines.join("\n").trim();
          text = isGroup ? stripMentions([title, body].filter(Boolean).join("\n").trim())
                         : [title, body].filter(Boolean).join("\n").trim();

          // 提取富文本中的图片
          for (const line of blocks) {
            for (const el of line) {
              if (el.tag === "img" && el.image_key) {
                logger.dim(`downloading image from post: ${el.image_key}`);
                const img = await downloadImage(client, msg.message_id, el.image_key);
                if (img) {
                  images.push(img);
                }
              }
            }
          }
        } else if (msg.message_type === "image") {
          const imageKey = (JSON.parse(msg.content) as { image_key?: string }).image_key;
          if (imageKey) {
            logger.dim(`downloading image: ${imageKey}`);
            const img = await downloadImage(client, msg.message_id, imageKey);
            if (img) {
              images = [img];
              text   = config.image_prompt ?? "分析图片，给出回应";
            } else {
              await sendText(client, chatId, "❌ 图片下载失败");
              return;
            }
          }
        } else if (msg.message_type === "file") {
          // 文件消息处理
          if (!fileConfig?.enabled) {
            await sendText(client, chatId, "❌ 文件处理功能未启用");
            return;
          }

          const fileContent = JSON.parse(msg.content) as {
            file_key?: string;
            file_name?: string;
            file_size?: number;
          };
          const fileKey = fileContent.file_key;
          const fileName = fileContent.file_name ?? "unknown";
          const fileSize = fileContent.file_size ?? 0;

          if (!fileKey) {
            await sendText(client, chatId, "❌ 无法获取文件信息");
            return;
          }

          // 检查文件大小
          const sizeLimit = fileConfig.size_limit ?? 30 * 1024 * 1024;
          if (fileSize > sizeLimit) {
            const limitMB = Math.round(sizeLimit / 1024 / 1024);
            const sizeMB = Math.round(fileSize / 1024 / 1024);
            await sendText(client, chatId, `❌ 文件太大（${sizeMB}MB），超过限制（${limitMB}MB）`);
            return;
          }

          // 检查是否在多文件模式
          if (multifile.isActive(profileKey, chatId)) {
            // 多文件模式：下载并缓存
            logger.dim(`[multifile] downloading file: ${fileName}`);
            const tempDir = fileConfig.temp_dir ?? path.join(os.homedir(), ".larkcc", "temp", profileKey);
            const file = await downloadFile(client, msg.message_id, fileKey, tempDir, fileName);
            if (file) {
              multifile.addItem(profileKey, chatId, { type: "file", content: file, timestamp: Date.now() });
              const count = multifile.getItemCount(profileKey, chatId);
              // 添加 reaction 确认
              await client.im.messageReaction.create({
                path: { message_id: msg.message_id },
                data: { reaction_type: { emoji_type: "OK" } },
              }).catch(() => {});
              logger.dim(`[multifile] cached file ${count}: ${fileName}`);
            } else {
              await sendText(client, chatId, `❌ 文件下载失败：${fileName}`);
            }
            return; // 不继续处理，等待 /mf done
          }

          // 单文件模式：下载并处理
          logger.dim(`downloading file: ${fileName}`);
          const tempDir = fileConfig.temp_dir ?? path.join(os.homedir(), ".larkcc", "temp", profileKey);
          downloadedFile = await downloadFile(client, msg.message_id, fileKey, tempDir, fileName);
          if (!downloadedFile) {
            await sendText(client, chatId, "❌ 文件下载失败，请重试");
            return;
          }
        }

        if (!text && images.length === 0 && !downloadedFile) return;

        // ── 多文件模式处理 ────────────────────────────────────────

        // 检查多文件模式超时
        if (fileConfig && multifile.isActive(profileKey, chatId)) {
          const timeout = fileConfig.multifile_timeout ?? 300;
          const timeoutItems = multifile.checkTimeout(profileKey, chatId, timeout);
          if (timeoutItems && timeoutItems.length > 0) {
            logger.dim(`[multifile] timeout, auto-processing ${timeoutItems.length} items`);
            // 超时自动处理 - 这里暂时只通知用户，不自动处理
            await sendText(client, chatId, `⏰ 多文件模式已超时，已缓存 ${timeoutItems.length} 个项目。发送 /mf done 开始处理，或 /mf start 重新开始。`);
            return;
          }
        }

        // 多文件模式下，文字消息作为说明缓存
        if (text && !text.startsWith("/") && multifile.isActive(profileKey, chatId)) {
          multifile.addItem(profileKey, chatId, { type: "text", content: text, timestamp: Date.now() });
          const count = multifile.getItemCount(profileKey, chatId);
          await client.im.messageReaction.create({
            path: { message_id: msg.message_id },
            data: { reaction_type: { emoji_type: "OK" } },
          }).catch(() => {});
          logger.dim(`[multifile] cached text ${count}: ${text.slice(0, 50)}...`);
          return;
        }

        // ── Slash 命令拦截 ────────────────────────────────────
        if (text.startsWith("/")) {
          const cmdText = text.toLowerCase().trim();

          if (cmdText === "/stop" || cmdText === "/cancel") {
            if (processing && currentAbortController) {
              currentAbortController.abort();
              await sendText(client, chatId, "⏹ 已发送中断信号，等待当前步骤完成...");
            } else if (processing) {
              processing = false;
              processingStartedAt = 0;
              await sendText(client, chatId, "⏹ 已强制释放，可以发新消息了");
            } else {
              await sendText(client, chatId, "没有正在处理的任务");
            }
            return;
          }

          const result = parseCommand(text, cwd, customCommands);
          if (result) {
            // 多文件模式命令处理
            if (result.type === "multifile_start") {
              const wasActive = multifile.isActive(profileKey, chatId);
              if (wasActive) {
                multifile.resetMode(profileKey, chatId);
                await sendText(client, chatId, "📁 多文件模式已重置，之前的缓存已清空，请重新发送文件");
              } else {
                multifile.startMode(profileKey, chatId);
                await sendText(client, chatId, "📁 多文件模式已开始，请发送文件和说明文字，完成后发送 /mf done");
              }
              return;
            }

            if (result.type === "multifile_done") {
              if (!multifile.isActive(profileKey, chatId)) {
                await sendText(client, chatId, "❌ 未在多文件模式中，请先发送 /mf start");
                return;
              }

              const items = multifile.endMode(profileKey, chatId);
              if (items.length === 0) {
                await sendText(client, chatId, "❌ 没有缓存的内容，请先发送文件");
                return;
              }

              // 构建多文件 prompt
              const fileItems = items.filter(i => i.type === "file");
              const textItems = items.filter(i => i.type === "text");

              if (fileItems.length === 0) {
                await sendText(client, chatId, "❌ 没有缓存文件，请先发送文件");
                return;
              }

              // 格式化文件列表
              const filesList = fileItems.map((item, idx) => {
                const file = item.content as DownloadedFile;
                return `${idx + 1}. ${file.filename}（${Math.round(file.size / 1024)}KB，${file.mime_type}）\n   路径：${file.filepath}`;
              }).join("\n");

              // 格式化文字说明
              const textContent = textItems.map(i => i.content as string).join("\n");

              // 使用配置的 multifile_prompt
              const mfPrompt = fileConfig?.multifile_prompt ?? "分析以下 {count} 个文件：\n{files}\n\n用户说明：{text}";
              text = mfPrompt
                .replace("{count}", String(fileItems.length))
                .replace("{files}", filesList)
                .replace("{text}", textContent || "（无文字说明）");

              logger.dim(`[multifile] processing ${fileItems.length} files, ${textItems.length} text items`);
              // 继续执行，进入正常的处理流程
            }

            if (result.type === "exec" || result.type === "help" || result.type === "unknown") {
              await sendText(client, chatId, result.output ?? "");
              return;
            }
            if (result.type === "prompt" && result.prompt) {
              text = result.prompt;
            }
          }
        }

        logger.msg(senderId, `[${isGroup ? "group" : "p2p"}] ${text || "[image]"}`);

        // 超时自动释放
        if (processing && Date.now() - processingStartedAt > PROCESSING_TIMEOUT_MS) {
          logger.warn("Processing timeout, force releasing lock...");
          processing = false;
          processingStartedAt = 0;
          currentAbortController = null;
        }

        if (processing) {
          const elapsed = Math.round((Date.now() - processingStartedAt) / 1000);
          logger.warn("Still processing previous message, skipping...");
          await sendText(client, chatId, `⏳ 上一条消息还在处理中（已${elapsed}秒），发送 /stop 可强制中断`);
          return;
        }

        processing = true;
        processingStartedAt = Date.now();
        currentAbortController = new AbortController();

        let reactionId: string | undefined;
        try {
          const reactionRes = await client.im.messageReaction.create({
            path: { message_id: msg.message_id },
            data: { reaction_type: { emoji_type: "OK" } },
          });
          reactionId = reactionRes.data?.reaction_id;
        } catch {}

        try {
          // 处理单文件：修改 prompt 包含文件信息
          let finalPrompt = text;
          if (downloadedFile && !multifile.isActive(profileKey, chatId)) {
            const fp = fileConfig?.prompt ?? "分析文件 {filename}（路径：{filepath}，大小：{size}，类型：{mime_type}）";
            const sizeStr = `${Math.round(downloadedFile.size / 1024)}KB`;
            finalPrompt = fp
              .replace("{filename}", downloadedFile.filename)
              .replace("{filepath}", downloadedFile.filepath)
              .replace("{size}", sizeStr)
              .replace("{mime_type}", downloadedFile.mime_type)
              .replace("{file_key}", downloadedFile.file_key);

            // 如果用户也发送了文字，附加到 prompt 后面
            if (text && !text.startsWith("/")) {
              finalPrompt = `${finalPrompt}\n\n用户说明：${text}`;
            }
          }

          await runAgent(finalPrompt, cwd, config, client, chatId, msg.message_id, images.length > 0 ? images : undefined, currentAbortController?.signal, profile);
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
          processingStartedAt = 0;
          currentAbortController = null;
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