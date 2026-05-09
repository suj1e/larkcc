import * as lark from "@larksuiteoapi/node-sdk";
import path from "path";
import os from "os";
import { sendText, downloadImage, downloadFile } from "./feishu/index.js";
import type { DownloadedFile } from "./feishu/index.js";
import { runAgent, ImageInput } from "./agent.js";
import { LarkccConfig, saveOwnerOpenId } from "./config.js";
import { parseCommand, CommandContext, runCmd } from "./commands.js";
import { getSession, setSession, getChatId, saveChatId } from "./session.js";
import { logger } from "./logger.js";
import * as multifile from "./multifile.js";

// 待确认的 EXEC 命令
interface PendingExec { cmd: string; cwd: string; timestamp: number; }

// 去掉消息里的 @ 提及文字，只保留实际内容
function stripMentions(text: string): string {
  return text.replace(/@\S+/g, "").trim();
}

export interface MessageHandlerContext {
  client: lark.Client;
  config: LarkccConfig;
  profile: string | undefined;
  cwd: string;
  botOpenId: string;
  startupTime: number;
  commandContext: CommandContext;
}

export function createMessageHandler(ctx: MessageHandlerContext) {
  const { client, config, profile, cwd, botOpenId, startupTime, commandContext } = ctx;

  let processing = false;
  let processingStartedAt = 0;
  let currentAbortController: AbortController | null = null;
  let processingTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let isTimedOut = false;
  let knownChatId = getChatId();
  const recentMessages = new Map<string, number>();
  const pendingExecConfirm = new Map<string, PendingExec>();

  const getOwnerOpenId = () => config.feishu.owner_open_id;
  const profileLabel = profile ? ` [${profile}]` : "";

  return async (data: any) => {
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

    // 群消息：只响应 @ 自己 或 引用了消息
    if (isGroup) {
      const mentions: Array<{ id?: { open_id?: string } }> = (msg as any).mentions ?? [];
      const atBot = botOpenId
        ? mentions.some(m => m.id?.open_id === botOpenId)
        : mentions.length > 0;
      const hasQuote = !!(msg as any).parent_id;
      if (!atBot && !hasQuote) return;
    }

    // 去重
    const dedupeKey = `${senderId}:${msg.message_id}`;
    const lastSeen  = recentMessages.get(dedupeKey);
    if (lastSeen && now - lastSeen < 30_000) return;
    recentMessages.set(dedupeKey, now);
    for (const [k, t] of recentMessages) {
      if (now - t > 30_000) recentMessages.delete(k);
    }

    // Owner 检测
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

      const lines  = blocks.map(line =>
        line.map(el => stripHtml(el.text ?? "")).join("").trim()
      ).filter(Boolean);
      const body = lines.join("\n").trim();
      text = isGroup ? stripMentions([title, body].filter(Boolean).join("\n").trim())
                     : [title, body].filter(Boolean).join("\n").trim();

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

      const sizeLimit = fileConfig.size_limit ?? 30 * 1024 * 1024;
      if (fileSize > sizeLimit) {
        const limitMB = Math.round(sizeLimit / 1024 / 1024);
        const sizeMB = Math.round(fileSize / 1024 / 1024);
        await sendText(client, chatId, `❌ 文件太大（${sizeMB}MB），超过限制（${limitMB}MB）`);
        return;
      }

      if (multifile.isActive(profileKey, chatId)) {
        logger.dim(`[multifile] downloading file: ${fileName}`);
        const tempDir = fileConfig.temp_dir ?? path.join(os.homedir(), ".larkcc", "temp", profileKey);
        const file = await downloadFile(client, msg.message_id, fileKey, tempDir, fileName);
        if (file) {
          multifile.addItem(profileKey, chatId, { type: "file", content: file, timestamp: Date.now() });
          const count = multifile.getItemCount(profileKey, chatId);
          await client.im.messageReaction.create({
            path: { message_id: msg.message_id },
            data: { reaction_type: { emoji_type: config.reaction?.processing ?? "Typing" } },
          }).catch(() => {});
          logger.dim(`[multifile] cached file ${count}: ${fileName}`);
        } else {
          await sendText(client, chatId, `❌ 文件下载失败：${fileName}`);
        }
        return;
      }

      logger.dim(`downloading file: ${fileName}`);
      const tempDir = fileConfig.temp_dir ?? path.join(os.homedir(), ".larkcc", "temp", profileKey);
      downloadedFile = await downloadFile(client, msg.message_id, fileKey, tempDir, fileName);
      if (!downloadedFile) {
        await sendText(client, chatId, "❌ 文件下载失败，请重试");
        return;
      }
    }

    if (!text && images.length === 0 && !downloadedFile) return;

    // ── 多文件模式处理 ────────────────────────────────────

    if (fileConfig && multifile.isActive(profileKey, chatId)) {
      const timeout = fileConfig.multifile_timeout ?? 300;
      const timeoutItems = multifile.checkTimeout(profileKey, chatId, timeout);
      if (timeoutItems && timeoutItems.length > 0) {
        logger.dim(`[multifile] timeout, auto-processing ${timeoutItems.length} items`);
        await sendText(client, chatId, `⏰ 多文件模式已超时，已缓存 ${timeoutItems.length} 个项目。发送 /mf done 开始处理，或 /mf start 重新开始。`);
        return;
      }
    }

    if (text && !text.startsWith("/") && multifile.isActive(profileKey, chatId)) {
      multifile.addItem(profileKey, chatId, { type: "text", content: text, timestamp: Date.now() });
      const count = multifile.getItemCount(profileKey, chatId);
      await client.im.messageReaction.create({
        path: { message_id: msg.message_id },
        data: { reaction_type: { emoji_type: config.reaction?.processing ?? "OK" } },
      }).catch(() => {});
      logger.dim(`[multifile] cached text ${count}: ${text.slice(0, 50)}...`);
      return;
    }

    // ── EXEC 命令确认处理 ──────────────────────────────────
    const pendingExec = pendingExecConfirm.get(chatId);
    if (pendingExec && Date.now() - pendingExec.timestamp < 5 * 60 * 1000) {
      const reply = text.toLowerCase().trim();
      if (reply === "y" || reply === "yes" || reply === "确认") {
        pendingExecConfirm.delete(chatId);
        logger.info(`User confirmed exec: ${pendingExec.cmd}`);
        const output = runCmd(pendingExec.cmd, pendingExec.cwd);
        await sendText(client, chatId, `✅ 已执行\n\`\`\`\n${output}\n\`\`\``);
        return;
      } else if (reply === "n" || reply === "no" || reply === "取消") {
        pendingExecConfirm.delete(chatId);
        await sendText(client, chatId, "❌ 已取消执行");
        return;
      }
    }

    for (const [key, value] of pendingExecConfirm.entries()) {
      if (Date.now() - value.timestamp > 5 * 60 * 1000) {
        pendingExecConfirm.delete(key);
      }
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

      const result = parseCommand(text, cwd, commandContext);
      if (result) {
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

          const fileItems = items.filter(i => i.type === "file");
          const textItems = items.filter(i => i.type === "text");

          if (fileItems.length === 0) {
            await sendText(client, chatId, "❌ 没有缓存文件，请先发送文件");
            return;
          }

          const filesList = fileItems.map((item, idx) => {
            const file = item.content as DownloadedFile;
            return `${idx + 1}. ${file.filename}（${Math.round(file.size / 1024)}KB，${file.mime_type}）\n   路径：${file.filepath}`;
          }).join("\n");

          const textContent = textItems.map(i => i.content as string).join("\n");

          const mfPrompt = fileConfig?.multifile_prompt ?? "分析以下 {count} 个文件：\n{files}\n\n用户说明：{text}";
          text = mfPrompt
            .replace("{count}", String(fileItems.length))
            .replace("{files}", filesList)
            .replace("{text}", textContent || "（无文字说明）");

          logger.dim(`[multifile] processing ${fileItems.length} files, ${textItems.length} text items`);
        }

        if (result.type === "exec" || result.type === "help" || result.type === "unknown") {
          await sendText(client, chatId, result.output ?? "");
          return;
        }

        if (result.type === "exec_confirm" && result.cmd) {
          const warningMsg = `⚠️ 危险命令检测\n\n${result.output}\n\n命令：\n\`\`\`\n${result.cmd}\n\`\`\`\n\n确认执行？回复 y 确认，回复 n 取消`;
          await sendText(client, chatId, warningMsg);
          pendingExecConfirm.set(chatId, { cmd: result.cmd, cwd, timestamp: Date.now() });
          return;
        }
        if (result.type === "prompt" && result.prompt) {
          text = result.prompt;
        }
      }
    }

    logger.msg(senderId, `[${isGroup ? "group" : "p2p"}] ${text || "[image]"}`);

    if (processing) {
      const elapsed = Math.round((Date.now() - processingStartedAt) / 1000);
      logger.warn("Still processing previous message, skipping...");
      await sendText(client, chatId, `⏳ 上一条消息还在处理中（已${elapsed}秒），发送 /stop 可强制中断`);
      return;
    }

    processing = true;
    processingStartedAt = Date.now();
    isTimedOut = false;
    currentAbortController = new AbortController();

    const timeoutMs = config.processing_timeout_ms ?? 30 * 60 * 1000;
    processingTimeoutTimer = setTimeout(() => {
      if (processing && currentAbortController) {
        logger.warn(`Processing timeout (${timeoutMs / 1000}s), aborting...`);
        isTimedOut = true;
        currentAbortController.abort();
      }
    }, timeoutMs);

    let reactionId: string | undefined;
    try {
      const reactionRes = await client.im.messageReaction.create({
        path: { message_id: msg.message_id },
        data: { reaction_type: { emoji_type: config.reaction?.processing ?? "Typing" } },
      });
      reactionId = reactionRes.data?.reaction_id;
    } catch {}

    try {
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

        if (text && !text.startsWith("/")) {
          finalPrompt = `${finalPrompt}\n\n用户说明：${text}`;
        }
      }

      const result = await runAgent(finalPrompt, cwd, config, client, chatId, msg.message_id, images.length > 0 ? images : undefined, currentAbortController ?? undefined, profile);
      if (processingTimeoutTimer) clearTimeout(processingTimeoutTimer);
      if (reactionId) {
        await client.im.messageReaction.delete({
          path: { message_id: msg.message_id, reaction_id: reactionId },
        }).catch(() => {});
      }
      if (isTimedOut) {
        await sendText(client, chatId, `⏰ 处理超时（${Math.round(timeoutMs / 60000)}分钟），已终止。以上为部分结果。`);
        await client.im.messageReaction.create({
          path: { message_id: msg.message_id },
          data: { reaction_type: { emoji_type: config.reaction?.timeout ?? "Clock" } },
        }).catch(() => {});
      } else if (result === "aborted") {
        await sendText(client, chatId, "✅ 已中断");
        await client.im.messageReaction.create({
          path: { message_id: msg.message_id },
          data: { reaction_type: { emoji_type: config.reaction?.error ?? "OnIt" } },
        }).catch(() => {});
      } else {
        await client.im.messageReaction.create({
          path: { message_id: msg.message_id },
          data: { reaction_type: { emoji_type: config.reaction?.done ?? "DONE" } },
        }).catch(() => {});
      }
    } catch (err) {
      if (processingTimeoutTimer) clearTimeout(processingTimeoutTimer);
      logger.error(`Agent error: ${String(err)}`);
      await sendText(client, chatId, `❌ 出错了：${String(err)}`);
      if (reactionId) {
        await client.im.messageReaction.delete({
          path: { message_id: msg.message_id, reaction_id: reactionId },
        }).catch(() => {});
      }
      await client.im.messageReaction.create({
        path: { message_id: msg.message_id },
        data: { reaction_type: { emoji_type: config.reaction?.error ?? "OnIt" } },
      }).catch(() => {});
    } finally {
      processing = false;
      processingStartedAt = 0;
      currentAbortController = null;
      processingTimeoutTimer = null;
      isTimedOut = false;
    }
  };
}
