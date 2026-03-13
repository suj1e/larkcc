import fs from "fs";
import path from "path";
import os from "os";

const STATE_PATH = path.join(os.homedir(), ".larkcc", "state.json");

function loadState(): Record<string, string> {
  try {
    if (!fs.existsSync(STATE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state: Record<string, string>): void {
  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

// 内存缓存
let memorySessionId: string | undefined;

export function getSession(persist = false): string | undefined {
  if (persist) {
    return loadState().session_id;
  }
  return memorySessionId;
}

export function setSession(sessionId: string): void {
  memorySessionId = sessionId;
  // 同时持久化，供 --continue 使用
  const state = loadState();
  state.session_id = sessionId;
  saveState(state);
}

export function clearSession(): void {
  memorySessionId = undefined;
  const state = loadState();
  delete state.session_id;
  saveState(state);
}
