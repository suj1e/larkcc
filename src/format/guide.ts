import fs from "fs";
import os from "os";
import path from "path";
import DEFAULT_FORMAT_GUIDE from "./default-guide.js";

function loadFormatGuideContent(): string {
  const userPath = path.join(os.homedir(), ".larkcc", "format-guide.md");
  try {
    if (fs.existsSync(userPath)) {
      const content = fs.readFileSync(userPath, "utf8").trim();
      if (content) return content;
    }
  } catch {}

  return DEFAULT_FORMAT_GUIDE;
}

let cached: string | null = null;

export function getFormatGuideContent(): string {
  return cached ?? (cached = loadFormatGuideContent());
}
