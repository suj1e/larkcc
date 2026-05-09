/**
 * 多 Agent 任务面板 — API 调用 + 生命周期控制器
 *
 * 卡片 JSON 构建在 ../card/task-panel.ts
 * 本文件负责：发送/更新卡片（API）+ 管理多任务状态（Controller）
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { buildTaskPanelCard } from "../card/index.js";
import type { TaskPanelStatus, TaskPanelCardOptions } from "../card/index.js";
import { replyMessage, patchMessage } from "./lark.js";
import { logger } from "../logger.js";

// Re-export types for consumers
export type { TaskPanelStatus, TaskPanelCardOptions };

// ── API 调用 ─────────────────────────────────────────────────

export async function sendTaskCard(
  client: lark.Client,
  chatId: string,
  rootMsgId: string,
  description: string,
  headerIconImgKey?: string,
): Promise<string> {
  const card = buildTaskPanelCard({ description, status: "running", headerIconImgKey });
  const { messageId } = await replyMessage(client, rootMsgId, {
    content: JSON.stringify(card),
    msgType: "interactive",
  });
  return messageId;
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

// ── 生命周期控制器 ────────────────────────────────────────────

interface TaskState {
  msgId: string;
  description: string;
  status: TaskPanelStatus;
  summary?: string;
  lastToolName?: string;
  startTime: number;
  tokens?: number;
  toolsUsed: string[];
}

export interface TaskPanelControllerOptions {
  client: lark.Client;
  chatId: string;
  rootMsgId: string;
  headerIconImgKey?: string;
}

export class TaskPanelController {
  private client: lark.Client;
  private chatId: string;
  private rootMsgId: string;
  private headerIconImgKey?: string;
  private tasks = new Map<string, TaskState>();

  constructor(options: TaskPanelControllerOptions) {
    this.client = options.client;
    this.chatId = options.chatId;
    this.rootMsgId = options.rootMsgId;
    this.headerIconImgKey = options.headerIconImgKey;
  }

  /** 子 agent 启动：创建任务面板卡片 */
  async onTaskStarted(event: {
    task_id: string;
    description: string;
  }): Promise<void> {
    if (this.tasks.has(event.task_id)) return;

    try {
      const msgId = await sendTaskCard(
        this.client,
        this.chatId,
        this.rootMsgId,
        event.description.slice(0, 80),
        this.headerIconImgKey,
      );
      this.tasks.set(event.task_id, {
        msgId,
        description: event.description,
        status: "running",
        startTime: Date.now(),
        toolsUsed: [],
      });
      logger.dim(`[task-panel] started: ${event.description.slice(0, 40)}`);
    } catch (err) {
      console.error("[task-panel] failed to create card:", err);
    }
  }

  /** 子 agent 进度更新 */
  async onTaskProgress(event: {
    task_id: string;
    description?: string;
    last_tool_name?: string;
    usage?: { total_tokens: number; duration_ms: number };
    summary?: string;
  }): Promise<void> {
    const task = this.tasks.get(event.task_id);
    if (!task || task.status !== "running") return;

    // 更新本地状态
    if (event.summary) task.summary = event.summary;
    if (event.last_tool_name) {
      task.lastToolName = event.last_tool_name;
      if (task.toolsUsed[task.toolsUsed.length - 1] !== event.last_tool_name) {
        task.toolsUsed.push(event.last_tool_name);
      }
    }
    if (event.usage) {
      task.tokens = event.usage.total_tokens;
    }

    try {
      await updateTaskCard(this.client, task.msgId, {
        description: task.description,
        status: "running",
        summary: task.summary,
        lastToolName: task.lastToolName,
        toolsUsed: task.toolsUsed,
        elapsedSeconds: (Date.now() - task.startTime) / 1000,
        tokens: task.tokens,
        headerIconImgKey: this.headerIconImgKey,
      });
    } catch (err) {
      console.error("[task-panel] failed to update progress:", err);
    }
  }

  /** 子 agent 完成/失败/停止 */
  async onTaskNotification(event: {
    task_id: string;
    status: "completed" | "failed" | "stopped";
    summary: string;
    usage?: { total_tokens: number; duration_ms: number };
  }): Promise<void> {
    const task = this.tasks.get(event.task_id);
    if (!task) return;

    task.status = event.status;
    task.summary = event.summary;
    if (event.usage) task.tokens = event.usage.total_tokens;

    const elapsedSeconds = event.usage?.duration_ms
      ? event.usage.duration_ms / 1000
      : (Date.now() - task.startTime) / 1000;

    try {
      await updateTaskCard(this.client, task.msgId, {
        description: task.description,
        status: event.status,
        summary: event.summary,
        toolsUsed: task.toolsUsed,
        elapsedSeconds,
        tokens: task.tokens,
        headerIconImgKey: this.headerIconImgKey,
      });
      logger.dim(`[task-panel] ${event.status}: ${task.description.slice(0, 40)}`);
    } catch (err) {
      console.error("[task-panel] failed to update notification:", err);
    }
  }

  /** 主 agent abort 时标记所有运行中的面板为 stopped */
  async abortAll(): Promise<void> {
    const running = [...this.tasks.values()].filter(t => t.status === "running");
    for (const task of running) {
      task.status = "stopped";
      try {
        await updateTaskCard(this.client, task.msgId, {
          description: task.description,
          status: "stopped",
          summary: task.summary ?? "Aborted",
          toolsUsed: task.toolsUsed,
          elapsedSeconds: (Date.now() - task.startTime) / 1000,
          tokens: task.tokens,
        });
      } catch (err) {
        console.error("[task-panel] failed to abort card:", err);
      }
    }
  }

  /** 主 agent 完成时汇总 */
  async completeAll(): Promise<void> {
    const running = [...this.tasks.values()].filter(t => t.status === "running");
    for (const task of running) {
      task.status = "completed";
      try {
        await updateTaskCard(this.client, task.msgId, {
          description: task.description,
          status: "completed",
          summary: task.summary ?? "Done",
          toolsUsed: task.toolsUsed,
          elapsedSeconds: (Date.now() - task.startTime) / 1000,
          tokens: task.tokens,
        });
      } catch (err) {
        console.error("[task-panel] failed to complete card:", err);
      }
    }
  }

  /** 获取当前运行中的任务数量 */
  get runningCount(): number {
    return [...this.tasks.values()].filter(t => t.status === "running").length;
  }

  /** 获取所有任务的状态摘要（用于主卡片状态栏） */
  getStatusSummary(): string {
    const tasks = [...this.tasks.values()];
    if (tasks.length === 0) return "";
    const running = tasks.filter(t => t.status === "running");
    if (running.length === 0) return "";
    const parts = running.map(t => {
      const name = t.description.slice(0, 20);
      const tool = t.lastToolName ? ` (${t.lastToolName})` : "";
      return `${name}${tool}`;
    });
    return `🤖 ${running.length} agent${running.length > 1 ? "s" : ""}: ${parts.join(", ")}`;
  }
}
