import fs from "fs";
import path from "path";
import os from "os";
import yaml from "js-yaml";

export interface FeishuConfig {
  app_id: string;
  app_secret: string;
  owner_open_id: string;
}

export interface CleanupConfig {
  enabled: boolean;    // 是否启用自动清理
  max_docs: number;    // 最大保留文档数
  notify: boolean;     // 清理时是否通知
}

export interface FileConfig {
  enabled: boolean;           // 是否启用文件处理
  size_limit: number;         // 文件大小限制 (bytes)
  temp_dir: string;           // 临时文件目录
  prompt: string;             // 单文件 prompt
  multifile_prompt: string;   // 多文件 prompt
  multifile_timeout: number;  // 多文件模式超时 (秒)
}

export interface OverflowConfig {
  mode: "chunk" | "document";
  chunk: { threshold: number };
  document: {
    threshold: number;
    title_template: string;
    cleanup: CleanupConfig;
  };
}

// 卡片表格限制配置
export interface CardTableConfig {
  max_tables_per_card: number;   // 单卡片最大表格数，超过则拆分或写文档，默认 5
}

export interface ExecSecurity {
  enabled: boolean;              // 是否启用安全检查
  blacklist: string[];           // 黑名单关键词
  confirm_on_warning: boolean;   // 检测到危险命令时是否需要确认
}

export interface ReactionConfig {
  processing: string;  // 处理中的 emoji_type
  done: string;        // 完成的 emoji_type
  error: string;       // 出错的 emoji_type
}

export interface FormatGuideConfig {
  enabled: boolean;  // 是否注入飞书格式指导 prompt
}

export interface StreamingConfig {
  enabled: boolean;            // 是否启用流式输出
  mode: "cardkit" | "update" | "none";  // 流式模式
  flush_interval_ms: number;   // 刷新间隔（毫秒）
  thinking_enabled: boolean;   // 是否显示思考过程
  fallback_on_error: boolean;  // CardKit/update 失败时是否降级
}

export interface ImageResolverConfig {
  enabled: boolean;            // 是否启用图片解析（下载外部图片上传到飞书）
}

export interface ProfileConfig {
  feishu: FeishuConfig;
  claude: {
    permission_mode?: "acceptEdits" | "auto" | "default";
    allowed_tools?: string[];
  };
  overflow?: OverflowConfig;
  format_guide?: FormatGuideConfig;  // 格式指导配置
  image_resolver?: ImageResolverConfig;  // 图片解析配置
  image_prompt?: string;  // 图片消息的默认提示词
  file?: Partial<FileConfig>;  // 文件处理配置
  commands?: Record<string, string>;  // 自定义 PROMPT 命令
  exec_commands?: Record<string, string>;  // 自定义 EXEC 命令
  exec_security?: ExecSecurity;  // EXEC 安全配置
}

export interface LarkccConfig extends ProfileConfig {
  reaction?: ReactionConfig;
  thinking_words?: string[];
  card_table?: CardTableConfig;
  format_guide?: FormatGuideConfig;
  streaming?: StreamingConfig;
  image_resolver?: ImageResolverConfig;
}

export interface RawConfig {
  feishu: FeishuConfig;          // default profile
  claude?: ProfileConfig["claude"];
  overflow?: OverflowConfig;
  format_guide?: FormatGuideConfig;  // 格式指导配置
  streaming?: StreamingConfig;   // 流式输出配置
  image_resolver?: ImageResolverConfig;  // 图片解析配置
  image_prompt?: string;         // 图片消息的默认提示词
  file?: Partial<FileConfig>;    // 文件处理配置
  commands?: Record<string, string>;  // 自定义 PROMPT 命令
  exec_commands?: Record<string, string>;  // 自定义 EXEC 命令
  exec_security?: ExecSecurity;  // EXEC 安全配置
  reaction?: ReactionConfig;     // reaction emoji 配置
  thinking_words?: string[];     // 思考状态词列表
  card_table?: CardTableConfig;  // 卡片表格限制配置
  profiles?: Record<string, Partial<ProfileConfig>>;
}

const DEFAULT_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "LS"];
const DEFAULT_IMAGE_PROMPT = "分析图片，给出回应";
const GLOBAL_CONFIG_PATH = path.join(os.homedir(), ".larkcc", "config.yml");
const PROJECT_CONFIG_NAME = ".larkcc.yml";

const DEFAULT_OVERFLOW: OverflowConfig = {
  mode: "document",
  chunk: { threshold: 2800 },
  document: {
    threshold: 2800,
    title_template: "{datetime}",
    cleanup: {
      enabled: true,
      max_docs: 50,
      notify: true,
    },
  },
};

const DEFAULT_FILE_CONFIG: FileConfig = {
  enabled: true,
  size_limit: 30 * 1024 * 1024,  // 30MB
  temp_dir: path.join(os.homedir(), ".larkcc", "temp"),
  prompt: "分析文件 {filename}（路径：{filepath}，大小：{size}，类型：{mime_type}）",
  multifile_prompt: "分析以下 {count} 个文件：\n{files}\n\n用户说明：{text}",
  multifile_timeout: 300,  // 5分钟
};

const DEFAULT_EXEC_SECURITY: ExecSecurity = {
  enabled: true,
  blacklist: [
    "rm -rf",
    "rm -r",
    "sudo",
    "mkfs",
    "dd if=",
    "> /dev/",
    "chmod 777",
    "chmod -R",
    "chown -R",
    "shutdown",
    "reboot",
  ],
  confirm_on_warning: true,
};

const DEFAULT_REACTION: ReactionConfig = {
  processing: "Typing",
  done: "DONE",
  error: "OnIt",
};

const DEFAULT_CARD_TABLE: CardTableConfig = {
  max_tables_per_card: 5,
};

const DEFAULT_FORMAT_GUIDE: FormatGuideConfig = {
  enabled: true,
};

const DEFAULT_STREAMING: StreamingConfig = {
  enabled: true,
  mode: "cardkit",
  flush_interval_ms: 300,
  thinking_enabled: true,
  fallback_on_error: true,
};

const DEFAULT_IMAGE_RESOLVER: ImageResolverConfig = {
  enabled: true,
};

const DEFAULT_THINKING_WORDS: string[] = [
  "💭 思考中...",
  "🔍 分析中...",
  "📚 查阅中...",
  "✍️ 处理中...",
  "🧠 构思中...",
  "⚡ 计算中...",
  "🔬 研究中...",
  "📝 整理中...",
  "🎯 规划中...",
  "🔧 调试中...",
  "📖 阅读中...",
  "🌐 搜索中...",
  "🧩 组合中...",
  "🎨 设计中...",
  "💡 灵感中...",
  "🚀 启动中...",
  "🔄 更新中...",
  "📊 统计中...",
  "🛠️ 构建中...",
  "🧪 测试中...",
  "📦 打包中...",
  "⚡ 执行中...",
  "📥 获取中...",
  "📤 推送中...",
  "🔗 连接中...",
  "🧹 清理中...",
  "🎪 准备中...",
  "🎲 随机中...",
  "⏳ 进行中...",
  "💻 编码中...",
  "🌲 分叉中...",
  "🌿 合并中...",
  "📝 提交中...",
  "👀 审查中...",
  "🐛 除错中...",
  "✨ 优化中...",
  "🔨 重构中...",
  "📋 解析中...",
  "🧬 解构中...",
];

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
  let file: Partial<FileConfig> = raw.file ?? {};

  if (profile && profile !== "default") {
    const profileData = raw.profiles?.[profile];
    if (!profileData) throw new Error(`Profile "${profile}" not found. Run: larkcc --setup -p ${profile}`);
    feishu = { ...raw.feishu, ...profileData.feishu } as FeishuConfig;
    claude = { ...claude, ...profileData.claude };
    overflow = { ...overflow, ...profileData.overflow };
    file = { ...file, ...profileData.file };
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

  // 处理 temp_dir 中的 ~ 前缀
  let tempDir = file.temp_dir ?? DEFAULT_FILE_CONFIG.temp_dir;
  if (tempDir.startsWith("~")) {
    tempDir = path.join(os.homedir(), tempDir.slice(1));
  }
  // 为不同 profile 创建子目录
  const profileTempDir = profile && profile !== "default"
    ? path.join(tempDir, profile)
    : path.join(tempDir, "default");

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
        title_template: overflow.document?.title_template ?? DEFAULT_OVERFLOW.document.title_template,
        cleanup: {
          enabled: overflow.document?.cleanup?.enabled ?? DEFAULT_OVERFLOW.document.cleanup.enabled,
          max_docs: overflow.document?.cleanup?.max_docs ?? DEFAULT_OVERFLOW.document.cleanup.max_docs,
          notify: overflow.document?.cleanup?.notify ?? DEFAULT_OVERFLOW.document.cleanup.notify,
        },
      },
    },
    image_prompt: raw.image_prompt ?? DEFAULT_IMAGE_PROMPT,
    file: {
      enabled: file.enabled ?? DEFAULT_FILE_CONFIG.enabled,
      size_limit: file.size_limit ?? DEFAULT_FILE_CONFIG.size_limit,
      temp_dir: profileTempDir,
      prompt: file.prompt ?? DEFAULT_FILE_CONFIG.prompt,
      multifile_prompt: file.multifile_prompt ?? DEFAULT_FILE_CONFIG.multifile_prompt,
      multifile_timeout: file.multifile_timeout ?? DEFAULT_FILE_CONFIG.multifile_timeout,
    },
    commands: raw.commands,
    exec_commands: raw.exec_commands,
    exec_security: {
      enabled: raw.exec_security?.enabled ?? DEFAULT_EXEC_SECURITY.enabled,
      blacklist: raw.exec_security?.blacklist ?? DEFAULT_EXEC_SECURITY.blacklist,
      confirm_on_warning: raw.exec_security?.confirm_on_warning ?? DEFAULT_EXEC_SECURITY.confirm_on_warning,
    },
    reaction: {
      processing: raw.reaction?.processing ?? DEFAULT_REACTION.processing,
      done: raw.reaction?.done ?? DEFAULT_REACTION.done,
      error: raw.reaction?.error ?? DEFAULT_REACTION.error,
    },
    thinking_words: raw.thinking_words ?? DEFAULT_THINKING_WORDS,
    card_table: {
      max_tables_per_card: raw.card_table?.max_tables_per_card ?? DEFAULT_CARD_TABLE.max_tables_per_card,
    },
    format_guide: {
      enabled: raw.format_guide?.enabled ?? DEFAULT_FORMAT_GUIDE.enabled,
    },
    streaming: {
      enabled: raw.streaming?.enabled ?? DEFAULT_STREAMING.enabled,
      mode: raw.streaming?.mode ?? DEFAULT_STREAMING.mode,
      flush_interval_ms: raw.streaming?.flush_interval_ms ?? DEFAULT_STREAMING.flush_interval_ms,
      thinking_enabled: raw.streaming?.thinking_enabled ?? DEFAULT_STREAMING.thinking_enabled,
      fallback_on_error: raw.streaming?.fallback_on_error ?? DEFAULT_STREAMING.fallback_on_error,
    },
    image_resolver: {
      enabled: raw.image_resolver?.enabled ?? DEFAULT_IMAGE_RESOLVER.enabled,
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

  // 添加默认 image_prompt 配置（首次创建时）
  if (!raw.image_prompt) {
    raw.image_prompt = DEFAULT_IMAGE_PROMPT;
  }

  // 添加默认 file 配置（首次创建时）
  if (!raw.file) {
    raw.file = DEFAULT_FILE_CONFIG;
  }

  // 确保 cleanup 配置存在（兼容旧配置）
  if (!raw.overflow.document?.cleanup) {
    raw.overflow.document = raw.overflow.document || {};
    raw.overflow.document.cleanup = DEFAULT_OVERFLOW.document.cleanup;
  }

  // 添加默认 reaction 配置（首次创建时）
  if (!raw.reaction) {
    raw.reaction = DEFAULT_REACTION;
  }

  // 添加默认 thinking_words 配置（首次创建时）
  if (!raw.thinking_words) {
    raw.thinking_words = DEFAULT_THINKING_WORDS;
  }

  // 添加默认 streaming 配置（首次创建时）
  if (!raw.streaming) {
    raw.streaming = DEFAULT_STREAMING;
  }

  // 添加默认 image_resolver 配置（首次创建时）
  if (!raw.image_resolver) {
    raw.image_resolver = DEFAULT_IMAGE_RESOLVER;
  }

  // 添加默认 format_guide 配置（首次创建时）
  if (!raw.format_guide) {
    raw.format_guide = DEFAULT_FORMAT_GUIDE;
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