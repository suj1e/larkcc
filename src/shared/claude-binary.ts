/**
 * Claude 二进制查找
 *
 * 统一 claude CLI 查找逻辑，供 claude.ts 和 app.ts 共用。
 */

import { execSync } from "child_process";

export function findClaudeBinary(): string | undefined {
  const cmd = process.platform === "win32"
    ? "where claude 2>nul"
    : "which claude 2>/dev/null || command -v claude 2>/dev/null";
  try {
    const result = execSync(cmd, { encoding: "utf8", timeout: 5000 }).trim();
    if (result) return result.split(/[\r\n]/)[0];
  } catch {}
  return undefined;
}
