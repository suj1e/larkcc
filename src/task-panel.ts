/**
 * 多 Agent 任务面板控制器
 *
 * 当 Claude 通过 Agent 工具派发子 agent 时，
 * 为每个子 agent 创建独立的飞书任务面板卡片，
 * 实时显示进度摘要、状态和耗时。
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { sendTaskCard, updateTaskCard, type TaskPanelStatus } from "./feishu.js";
import { logger } from "./logger.js";

interface TaskState {
  msgId: string;
  description: string;
  status: TaskPanelStatus;
  summary?: string;
  lastToolName?: string;
  startTime: number;
  tokens?: number;
}

export interface TaskPanelControllerOptions {
  client: lark.Client;
  chatId: string;
  rootMsgId: string;
  cardTitle?: string;
}

export class TaskPanelController {
  private client: lark.Client;
  private chatId: string;
  private rootMsgId: string;
  private cardTitle?: string;
  private tasks = new Map<string, TaskState>();

  constructor(options: TaskPanelControllerOptions) {
    this.client = options.client;
    this.chatId = options.chatId;
    this.rootMsgId = options.rootMsgId;
    this.cardTitle = options.cardTitle;
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
        this.cardTitle,
      );
      this.tasks.set(event.task_id, {
        msgId,
        description: event.description,
        status: "running",
        startTime: Date.now(),
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
    if (event.last_tool_name) task.lastToolName = event.last_tool_name;
    if (event.usage) {
      task.tokens = event.usage.total_tokens;
    }

    try {
      await updateTaskCard(this.client, task.msgId, {
        description: task.description,
        status: "running",
        summary: task.summary,
        lastToolName: task.lastToolName,
        elapsedSeconds: (Date.now() - task.startTime) / 1000,
        tokens: task.tokens,
        cardTitle: this.cardTitle,
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
        elapsedSeconds,
        tokens: task.tokens,
        cardTitle: this.cardTitle,
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
          elapsedSeconds: (Date.now() - task.startTime) / 1000,
          tokens: task.tokens,
          cardTitle: this.cardTitle,
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
          elapsedSeconds: (Date.now() - task.startTime) / 1000,
          tokens: task.tokens,
          cardTitle: this.cardTitle,
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
