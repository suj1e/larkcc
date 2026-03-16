import fs from "fs";
import path from "path";
import os from "os";

const STATE_DIR = path.join(os.homedir(), ".larkcc");

function statePath(profile?: string): string {
  if (!profile || profile === "default") {
    return path.join(STATE_DIR, "state.json");
  }
  return path.join(STATE_DIR, `state-${profile}.json`);
}

function loadState(profile?: string): Record<string, string> {
  try {
    const p = statePath(profile);
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state: Record<string, string>, profile?: string): void {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(statePath(profile), JSON.stringify(state, null, 2), "utf8");
}

// 内存缓存
let memorySessionId: string | undefined;
let currentProfile: string | undefined;

export function initSession(profile?: string): void {
  currentProfile = profile;
  memorySessionId = undefined;
}

export function getSession(persist = false): string | undefined {
  if (persist) return loadState(currentProfile).session_id;
  return memorySessionId;
}

export function setSession(sessionId: string): void {
  memorySessionId = sessionId;
  const state = loadState(currentProfile);
  state.session_id = sessionId;
  saveState(state, currentProfile);
}

export function clearSession(): void {
  memorySessionId = undefined;
  const state = loadState(currentProfile);
  delete state.session_id;
  saveState(state, currentProfile);
}

export function getChatId(): string | null {
  return loadState(currentProfile).chat_id ?? null;
}

export function saveChatId(chatId: string): void {
  const state = loadState(currentProfile);
  state.chat_id = chatId;
  saveState(state, currentProfile);
}