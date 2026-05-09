/**
 * 多文件模式状态管理
 *
 * 按 profile + chat_id 隔离多文件会话状态
 */

import { DownloadedFile } from "./feishu/index.js";

// 多文件项目类型
export interface MultiFileItem {
  type: "file" | "text";
  content: DownloadedFile | string;  // 文件信息或文字内容
  timestamp: number;
}

// 多文件会话状态
interface MultiFileSession {
  active: boolean;
  items: MultiFileItem[];
  startedAt: number;
}

// 内存存储（按 profile:chat_id 作为 key）
const sessions = new Map<string, MultiFileSession>();

/**
 * 生成 session key
 */
function getSessionKey(profile: string, chatId: string): string {
  return `${profile}:${chatId}`;
}

/**
 * 开始多文件模式
 */
export function startMode(profile: string, chatId: string): void {
  const key = getSessionKey(profile, chatId);
  sessions.set(key, {
    active: true,
    items: [],
    startedAt: Date.now(),
  });
}

/**
 * 重置多文件模式（清空已缓存的内容，重新开始）
 */
export function resetMode(profile: string, chatId: string): void {
  const key = getSessionKey(profile, chatId);
  sessions.set(key, {
    active: true,
    items: [],
    startedAt: Date.now(),
  });
}

/**
 * 添加项目到多文件会话
 */
export function addItem(profile: string, chatId: string, item: MultiFileItem): void {
  const key = getSessionKey(profile, chatId);
  const session = sessions.get(key);
  if (session && session.active) {
    session.items.push(item);
  }
}

/**
 * 获取多文件会话中的所有项目
 */
export function getItems(profile: string, chatId: string): MultiFileItem[] {
  const key = getSessionKey(profile, chatId);
  const session = sessions.get(key);
  return session?.items ?? [];
}

/**
 * 结束多文件模式并返回所有项目
 */
export function endMode(profile: string, chatId: string): MultiFileItem[] {
  const key = getSessionKey(profile, chatId);
  const session = sessions.get(key);
  const items = session?.items ?? [];
  sessions.delete(key);
  return items;
}

/**
 * 检查是否在多文件模式中
 */
export function isActive(profile: string, chatId: string): boolean {
  const key = getSessionKey(profile, chatId);
  const session = sessions.get(key);
  return session?.active ?? false;
}

/**
 * 检查多文件模式是否超时
 * @returns 如果超时，返回已缓存的项目；否则返回 null
 */
export function checkTimeout(profile: string, chatId: string, timeoutSeconds: number): MultiFileItem[] | null {
  const key = getSessionKey(profile, chatId);
  const session = sessions.get(key);

  if (!session || !session.active) {
    return null;
  }

  const elapsed = (Date.now() - session.startedAt) / 1000;
  if (elapsed > timeoutSeconds) {
    // 超时，返回项目并清除会话
    const items = session.items;
    sessions.delete(key);
    return items;
  }

  return null;
}

/**
 * 获取多文件模式的开始时间
 */
export function getStartedAt(profile: string, chatId: string): number | null {
  const key = getSessionKey(profile, chatId);
  const session = sessions.get(key);
  return session?.startedAt ?? null;
}

/**
 * 获取已缓存的项目数量
 */
export function getItemCount(profile: string, chatId: string): number {
  const key = getSessionKey(profile, chatId);
  const session = sessions.get(key);
  return session?.items.length ?? 0;
}
