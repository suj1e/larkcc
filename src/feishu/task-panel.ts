/**
 * 飞书任务面板 — API 调用层
 *
 * 卡片 JSON 构建已迁移至 ../card/task-panel.ts
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { buildTaskPanelCard } from "../card/index.js";
import type { TaskPanelStatus, TaskPanelCardOptions } from "../card/index.js";

// Re-export types for consumers
export type { TaskPanelStatus, TaskPanelCardOptions };

export async function sendTaskCard(
  client: lark.Client,
  chatId: string,
  rootMsgId: string,
  description: string,
  headerIconImgKey?: string,
): Promise<string> {
  const card = buildTaskPanelCard({ description, status: "running", headerIconImgKey });
  const res = await (client.im.message as any).reply({
    path: { message_id: rootMsgId },
    data: { content: JSON.stringify(card), msg_type: "interactive", reply_in_thread: false },
  });
  return res.data?.message_id ?? "";
}

export async function updateTaskCard(
  client: lark.Client,
  msgId: string,
  options: TaskPanelCardOptions,
): Promise<void> {
  const card = buildTaskPanelCard(options);
  await client.im.message.patch({
    path: { message_id: msgId },
    data: { content: JSON.stringify(card) },
  });
}
