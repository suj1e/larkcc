// 单项目单会话，key = owner_open_id（只有一个用户）
let currentSessionId: string | undefined;

export function getSession(): string | undefined {
  return currentSessionId;
}

export function setSession(sessionId: string): void {
  currentSessionId = sessionId;
}

export function clearSession(): void {
  currentSessionId = undefined;
}
