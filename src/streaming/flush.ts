/**
 * 流式输出共享类型和工具
 *
 * FlushController：互斥守卫 + 自适应节流 + 长间隔批处理
 * IStreamingCard：流式卡片统一接口
 */

// ── 常量 ──────────────────────────────────────────────────

/** 流式内容截断阈值（字符数） */
export const STREAMING_TRUNCATE = 4000;

// ── FlushController ──────────────────────────────────────────

const LONG_GAP_MS = 2000;   // 2 秒无新内容，强制刷新
const GAP_CHECK_INTERVAL = 500; // 每 500ms 检查一次长间隔
const HEARTBEAT_MS = 15000;  // 15 秒无 flush，发送心跳防止 CardKit 流式超时

export interface FlushControllerOptions {
  /** 最小刷新间隔（毫秒） */
  minIntervalMs: number;
  /** 刷新回调，接收完整 buffer 内容 */
  onFlush: (content: string) => Promise<void>;
  /** 刷新失败回调 */
  onError?: (error: unknown) => void;
}

/**
 * 刷新控制器
 *
 * 核心机制：
 * - 互斥锁防止并发刷新
 * - setTimeout 替代 setInterval（上次完成后才调度下次）
 * - 自适应延迟：delay = max(0, minInterval - elapsed)
 * - 长间隔检测：2s 无新内容 → 强制刷新剩余
 *
 * 生命周期：start() → [append() → doFlush()]* → stop()
 */
export class FlushController {
  private minIntervalMs: number;
  private onFlush: (content: string) => Promise<void>;
  private onError?: (error: unknown) => void;

  private buffer = "";
  private sentLength = 0;
  private flushing = false;        // 互斥锁
  private stopped = false;
  private lastFlushTime = 0;
  private lastAppendTime = 0;

  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private gapCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: FlushControllerOptions) {
    this.minIntervalMs = options.minIntervalMs;
    this.onFlush = options.onFlush;
    this.onError = options.onError;
  }

  /** 追加内容到 buffer */
  append(text: string): void {
    if (this.stopped) return;
    this.buffer += text;
    this.lastAppendTime = Date.now();
    this.scheduleFlush();
  }

  /** 启动长间隔检测 */
  start(): void {
    this.lastAppendTime = Date.now();
    this.lastFlushTime = Date.now();
    this.gapCheckTimer = setInterval(() => this.checkLongGap(), GAP_CHECK_INTERVAL);
  }

  /** 停止所有定时器。调用后 append() 不再生效，调用方负责刷新剩余 buffer 内容 */
  stop(): void {
    this.stopped = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.gapCheckTimer) {
      clearInterval(this.gapCheckTimer);
      this.gapCheckTimer = null;
    }
  }

  /** 强制刷新（即使 buffer 为空，用于工具状态变更等场景） */
  async flush(): Promise<void> {
    await this.doFlush(true);
  }

  /** 获取当前 buffer 内容 */
  getBuffer(): string {
    return this.buffer;
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.stopped) return;

    const elapsed = Date.now() - this.lastFlushTime;
    const delay = Math.max(0, this.minIntervalMs - elapsed);

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.doFlush(false);
    }, delay);
  }

  private async doFlush(force: boolean): Promise<void> {
    if (this.flushing || this.stopped) return;
    if (!force && this.buffer.length <= this.sentLength) return;

    this.flushing = true;
    try {
      await this.onFlush(this.buffer);
      if (!force) this.sentLength = this.buffer.length;
      this.lastFlushTime = Date.now();
    } catch (error) {
      if (this.onError) {
        this.onError(error);
      }
      this.stop();
      return;
    } finally {
      this.flushing = false;
    }

    // 刷新期间可能有新内容到达，继续调度
    if (!this.stopped && this.buffer.length > this.sentLength) {
      this.scheduleFlush();
    }
  }

  private checkLongGap(): void {
    if (this.stopped || this.flushing) return;
    const now = Date.now();
    // 15s 心跳：即使 buffer 无变化也 flush 一次，防止 CardKit 流式超时
    if (now - this.lastFlushTime > HEARTBEAT_MS) {
      void this.doFlush(true);
      return;
    }
    // 2s 长间隔：有未发送内容时强制刷新
    if (now - this.lastAppendTime > LONG_GAP_MS) {
      if (this.buffer.length > this.sentLength) {
        void this.doFlush(false);
      }
    }
  }
}

// ── 流式卡片接口 ──────────────────────────────────────────────

import type { CompletionOptions } from "../feishu/index.js";

/** @deprecated Import CompletionOptions from "../feishu/index.js" instead */
export type CompleteOptions = CompletionOptions;

export interface IStreamingCard {
  append(text: string): Promise<void>;
  complete(finalContent: string, options?: CompletionOptions): Promise<void>;
  abort(options?: { content?: string; thinking?: string; reasoningElapsedMs?: number }): Promise<void>;
  isDisabled(): boolean;
}
