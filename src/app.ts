import * as lark from "@larksuiteoapi/node-sdk";
import { createLarkClient, createWSClient } from "./feishu.js";
import { runAgent } from "./agent.js";
import { LarkccConfig } from "./config.js";
import { logger } from "./logger.js";

export async function startApp(cwd: string, config: LarkccConfig): Promise<void> {
  const { app_id, app_secret, owner_open_id } = config.feishu;

  const client = createLarkClient(app_id, app_secret);
  const wsClient = createWSClient(app_id, app_secret);

  // 是否有消息正在处理（单会话串行）
  let processing = false;

  logger.info(`Project: ${cwd}`);
  logger.info(`AppID:   ${app_id}`);
  logger.info(`Owner:   ${owner_open_id}`);
  logger.info("Connecting to Feishu...");

  wsClient.start({
    eventDispatcher: new lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data) => {
        const msg = data.message;

        // 只处理文本消息
        if (msg.message_type !== "text") return;

        // 只响应 owner
        const senderId = data.sender.sender_id?.open_id ?? "";
        if (senderId !== owner_open_id) {
          logger.warn(`Ignored message from unknown user: ${senderId}`);
          return;
        }

        const chatId = msg.chat_id;
        const text = (JSON.parse(msg.content) as { text?: string }).text?.trim();
        if (!text) return;

        logger.msg(senderId, text);

        // 串行处理，避免并发乱序
        if (processing) {
          logger.warn("Still processing previous message, skipping...");
          return;
        }

        processing = true;
        try {
          await runAgent(text, cwd, config, client, chatId);
        } catch (err) {
          logger.error(`Agent error: ${String(err)}`);
        } finally {
          processing = false;
        }
      },
    }),
  });

  logger.success("Feishu connected! Waiting for messages...");
  logger.dim("Press Ctrl+C to stop\n");

  // 优雅退出
  process.on("SIGINT", () => {
    console.log("");
    logger.info("Stopping larkcc...");
    process.exit(0);
  });
}
