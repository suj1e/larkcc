import fs from "fs";
import path from "path";
import os from "os";
import yaml from "js-yaml";

export interface FeishuConfig {
  app_id: string;
  app_secret: string;
  owner_open_id: string;
}

export interface OverflowConfig {
  mode: "chunk" | "document";
  chunk: { threshold: number };
  document: {
    threshold: number;
    folder_token: string;
    title_template: string;
  };
}

export interface ProfileConfig {
  feishu: FeishuConfig;
  claude: {
    permission_mode?: "acceptEdits" | "auto" | "default";
    allowed_tools?: string[];
  };
  overflow?: OverflowConfig;
}

export interface LarkccConfig extends ProfileConfig {}

export interface RawConfig {
  feishu: FeishuConfig;          // default profile
  claude?: ProfileConfig["claude"];
  overflow?: OverflowConfig;
  profiles?: Record<string, Partial<ProfileConfig>>;
}

const DEFAULT_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "LS"];
const GLOBAL_CONFIG_PATH = path.join(os.homedir(), ".larkcc", "config.yml");
const PROJECT_CONFIG_NAME = ".larkcc.yml";

const DEFAULT_OVERFLOW: OverflowConfig = {
  mode: "document",
  chunk: { threshold: 2800 },
  document: {
    threshold: 2800,
    folder_token: "",
    title_template: "{cwd} - {session_id} - {datetime}",
  },
};

function loadYml(filePath: string): any {
  if (!fs.existsSync(filePath)) return null;
  try {
    return yaml.load(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function loadConfig(cwd: string, profile?: string): LarkccConfig {
  const raw: RawConfig = loadYml(GLOBAL_CONFIG_PATH) ?? {};
  const projectOverride = loadYml(path.join(cwd, PROJECT_CONFIG_NAME)) ?? {};

  // 选择 profile
  let feishu: FeishuConfig;
  let claude = raw.claude ?? {};
  let overflow: Partial<OverflowConfig> = raw.overflow ?? {};

  if (profile && profile !== "default") {
    const profileData = raw.profiles?.[profile];
    if (!profileData) throw new Error(`Profile "${profile}" not found. Run: larkcc --setup -p ${profile}`);
    feishu = { ...raw.feishu, ...profileData.feishu } as FeishuConfig;
    claude = { ...claude, ...profileData.claude };
    overflow = { ...overflow, ...profileData.overflow };
  } else {
    feishu = raw.feishu;
  }

  // 项目级覆盖（不覆盖飞书配置，只覆盖 claude 配置）
  if (projectOverride.claude) {
    claude = { ...claude, ...projectOverride.claude };
  }

  if (!feishu?.app_id) throw new Error("Missing feishu.app_id in config");
  if (!feishu?.app_secret) throw new Error("Missing feishu.app_secret in config");
  // owner_open_id 可以为空，首次收到消息时自动填入

  return {
    feishu,
    claude: {
      permission_mode: claude.permission_mode ?? "acceptEdits",
      allowed_tools: claude.allowed_tools ?? DEFAULT_TOOLS,
    },
    overflow: {
      mode: overflow.mode ?? DEFAULT_OVERFLOW.mode,
      chunk: { threshold: overflow.chunk?.threshold ?? DEFAULT_OVERFLOW.chunk.threshold },
      document: {
        threshold: overflow.document?.threshold ?? DEFAULT_OVERFLOW.document.threshold,
        folder_token: overflow.document?.folder_token ?? DEFAULT_OVERFLOW.document.folder_token,
        title_template: overflow.document?.title_template ?? DEFAULT_OVERFLOW.document.title_template,
      },
    },
  };
}

export function globalConfigExists(): boolean {
  return fs.existsSync(GLOBAL_CONFIG_PATH);
}

export function saveProfile(profile: string | undefined, feishu: FeishuConfig): void {
  const dir = path.dirname(GLOBAL_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let raw: any = loadYml(GLOBAL_CONFIG_PATH) ?? {};

  if (!profile || profile === "default") {
    raw.feishu = feishu;
  } else {
    if (!raw.profiles) raw.profiles = {};
    raw.profiles[profile] = { feishu };
  }

  if (!raw.claude) {
    raw.claude = {
      permission_mode: "acceptEdits",
      allowed_tools: DEFAULT_TOOLS,
    };
  }

  // 添加默认 overflow 配置（首次创建时）
  if (!raw.overflow) {
    raw.overflow = DEFAULT_OVERFLOW;
  }

  fs.writeFileSync(GLOBAL_CONFIG_PATH, yaml.dump(raw), "utf8");
}

export function listProfiles(): Array<{ name: string; app_id: string }> {
  const raw: RawConfig = loadYml(GLOBAL_CONFIG_PATH) ?? {};
  const result: Array<{ name: string; app_id: string }> = [];

  if (raw.feishu?.app_id) {
    result.push({ name: "default", app_id: raw.feishu.app_id });
  }

  for (const [name, profile] of Object.entries(raw.profiles ?? {})) {
    result.push({ name, app_id: profile.feishu?.app_id ?? "(no app_id)" });
  }

  return result;
}

export { GLOBAL_CONFIG_PATH };

// 首次收到消息时自动写入 owner_open_id
export function saveOwnerOpenId(openId: string, profile?: string): void {
  const dir = path.dirname(GLOBAL_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let raw: any = loadYml(GLOBAL_CONFIG_PATH) ?? {};

  if (!profile || profile === "default") {
    if (!raw.feishu) raw.feishu = {};
    raw.feishu.owner_open_id = openId;
  } else {
    if (!raw.profiles) raw.profiles = {};
    if (!raw.profiles[profile]) raw.profiles[profile] = {};
    if (!raw.profiles[profile].feishu) raw.profiles[profile].feishu = {};
    raw.profiles[profile].feishu.owner_open_id = openId;
  }

  fs.writeFileSync(GLOBAL_CONFIG_PATH, yaml.dump(raw), "utf8");
}

// 保存云文档文件夹 token
export function saveFolderToken(folderToken: string, profile?: string): void {
  const dir = path.dirname(GLOBAL_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let raw: any = loadYml(GLOBAL_CONFIG_PATH) ?? {};

  if (!profile || profile === "default") {
    if (!raw.overflow) raw.overflow = {};
    if (!raw.overflow.document) raw.overflow.document = {};
    raw.overflow.document.folder_token = folderToken;
  } else {
    if (!raw.profiles) raw.profiles = {};
    if (!raw.profiles[profile]) raw.profiles[profile] = {};
    if (!raw.profiles[profile].overflow) raw.profiles[profile].overflow = {};
    if (!raw.profiles[profile].overflow.document) raw.profiles[profile].overflow.document = {};
    raw.profiles[profile].overflow.document.folder_token = folderToken;
  }

  fs.writeFileSync(GLOBAL_CONFIG_PATH, yaml.dump(raw), "utf8");
}

// ── OAuth Token 存储 ─────────────────────────────────────────

export interface AuthToken {
  access_token: string;      // user_access_token
  refresh_token: string;
  expires_at: number;        // 过期时间戳 (毫秒)
  refresh_expires_at: number;
  folder_token?: string;     // 用户授权的文件夹 token
}

const AUTH_DIR = path.join(os.homedir(), ".larkcc");

function authPath(profile?: string): string {
  return path.join(AUTH_DIR, `auth-${profile ?? "default"}.json`);
}

export function loadAuthToken(profile?: string): AuthToken | null {
  const p = authPath(profile);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function saveAuthToken(token: AuthToken, profile?: string): void {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(authPath(profile), JSON.stringify(token, null, 2), "utf8");
}

export function clearAuthToken(profile?: string): void {
  try { fs.unlinkSync(authPath(profile)); } catch {}
}