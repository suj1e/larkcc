import fs from "fs";
import path from "path";
import os from "os";
import yaml from "js-yaml";

export interface LarkccConfig {
  feishu: {
    app_id: string;
    app_secret: string;
    owner_open_id: string;
  };
  claude: {
    permission_mode?: "acceptEdits" | "auto" | "default";
    allowed_tools?: string[];
  };
}

const DEFAULT_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "LS"];
const GLOBAL_CONFIG_PATH = path.join(os.homedir(), ".larkcc", "config.yml");
const PROJECT_CONFIG_NAME = ".larkcc.yml";

function loadYml(filePath: string): Partial<LarkccConfig> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return yaml.load(fs.readFileSync(filePath, "utf8")) as Partial<LarkccConfig>;
  } catch {
    return null;
  }
}

function mergeConfig(
  base: Partial<LarkccConfig>,
  override: Partial<LarkccConfig>
): Partial<LarkccConfig> {
  return {
    feishu: { ...base.feishu, ...override.feishu } as LarkccConfig["feishu"],
    claude: { ...base.claude, ...override.claude },
  };
}

export function loadConfig(cwd: string): LarkccConfig {
  // 1. 全局配置
  const globalConfig = loadYml(GLOBAL_CONFIG_PATH) ?? {};

  // 2. 环境变量
  const envConfig: Partial<LarkccConfig> = {};
  if (process.env.LARKCC_APP_ID || process.env.LARKCC_APP_SECRET || process.env.LARKCC_OWNER_OPEN_ID) {
    envConfig.feishu = {
      app_id: process.env.LARKCC_APP_ID ?? "",
      app_secret: process.env.LARKCC_APP_SECRET ?? "",
      owner_open_id: process.env.LARKCC_OWNER_OPEN_ID ?? "",
    };
  }

  // 3. 项目级配置
  const projectConfig = loadYml(path.join(cwd, PROJECT_CONFIG_NAME)) ?? {};

  // 合并：全局 < 环境变量 < 项目
  const merged = mergeConfig(mergeConfig(globalConfig, envConfig), projectConfig);

  // 校验必填项
  if (!merged.feishu?.app_id) throw new Error("Missing feishu.app_id in config");
  if (!merged.feishu?.app_secret) throw new Error("Missing feishu.app_secret in config");
  if (!merged.feishu?.owner_open_id) throw new Error("Missing feishu.owner_open_id in config");

  return {
    feishu: merged.feishu,
    claude: {
      permission_mode: merged.claude?.permission_mode ?? "acceptEdits",
      allowed_tools: merged.claude?.allowed_tools ?? DEFAULT_TOOLS,
    },
  };
}

export function globalConfigExists(): boolean {
  return fs.existsSync(GLOBAL_CONFIG_PATH);
}

export function saveGlobalConfig(config: LarkccConfig): void {
  const dir = path.dirname(GLOBAL_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(GLOBAL_CONFIG_PATH, yaml.dump(config), "utf8");
}

export { GLOBAL_CONFIG_PATH };
