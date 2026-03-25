import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { logger } from "./logger.js";
import type { ExecSecurity } from "./config.js";

// 获取当前文件目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载内置 PROMPT 默认值
function loadDefaultPrompts(): Record<string, string> {
  const ymlPath = path.join(__dirname, "commands", "default-prompts.yml");
  try {
    const content = fs.readFileSync(ymlPath, "utf8");
    return yaml.load(content) as Record<string, string>;
  } catch {
    logger.warn("Failed to load default-prompts.yml");
    return {};
  }
}

const DEFAULT_PROMPTS = loadDefaultPrompts();

function detectPkgManager(cwd: string): string {
  if (fs.existsSync(`${cwd}/pnpm-lock.yaml`)) return "pnpm";
  if (fs.existsSync(`${cwd}/yarn.lock`)) return "yarn";
  if (fs.existsSync(`${cwd}/Cargo.toml`)) return "cargo";
  return "npm";
}

export function runCmd(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", timeout: 30000 }).trim();
  } catch (e: any) {
    return e.stdout?.trim() || e.stderr?.trim() || e.message || "Command failed";
  }
}

// ── 内置快速执行命令（不走 Claude，秒返回） ───────────────────

export const BUILTIN_EXEC: Record<string, (cwd: string) => string> = {
  "status": (cwd) => runCmd("git status && echo '---' && git log --oneline -5", cwd),
  "s":      (cwd) => runCmd("git status && echo '---' && git log --oneline -5", cwd),
  "diff":   (cwd) => runCmd("git diff", cwd),
  "d":      (cwd) => runCmd("git diff", cwd),
  "log":    (cwd) => runCmd("git log --oneline -20", cwd),
  "l":      (cwd) => runCmd("git log --oneline -20", cwd),
  "branch": (cwd) => runCmd("git branch -a", cwd),
  "b":      (cwd) => runCmd("git branch -a", cwd),
  "pwd":    (cwd) => runCmd("pwd && echo '---' && ls -la", cwd),
  "ps":     (_)   => runCmd("ps aux | grep -v grep | head -20", process.cwd()),
};

// ── 模板解析 ──────────────────────────────────────────────────

/**
 * 解析模板参数
 * 支持 {{param}} 和 {{param|default}} 语法
 */
export function parseTemplate(template: string, args: string): string {
  const parts = args.split(/\s+/).filter(Boolean);

  // 匹配所有 {{...}} 占位符
  let result = template;
  const placeholderRegex = /\{\{(\w+)(?:\|([^}]*))?\}\}/g;
  let match;
  let argIndex = 0;

  while ((match = placeholderRegex.exec(template)) !== null) {
    const [fullMatch, paramName, defaultValue] = match;
    const hasDefault = defaultValue !== undefined;

    // 特殊处理：args 表示所有剩余参数
    if (paramName === "args") {
      result = result.replace(fullMatch, args || defaultValue || "");
      continue;
    }

    // 按顺序取参数
    const value = parts[argIndex] || (hasDefault ? defaultValue : "");
    if (parts[argIndex]) argIndex++;

    result = result.replace(fullMatch, value);
  }

  return result;
}

// ── 安全检查 ──────────────────────────────────────────────────

export interface SecurityCheckResult {
  safe: boolean;
  reason?: string;
  needsConfirm?: boolean;
}

export function checkExecSecurity(
  cmd: string,
  security: ExecSecurity
): SecurityCheckResult {
  if (!security.enabled) {
    return { safe: true };
  }

  const cmdLower = cmd.toLowerCase();

  for (const keyword of security.blacklist) {
    if (cmdLower.includes(keyword.toLowerCase())) {
      return {
        safe: !security.confirm_on_warning,
        reason: `检测到危险关键词: ${keyword}`,
        needsConfirm: security.confirm_on_warning,
      };
    }
  }

  return { safe: true };
}

// ── 命令处理 ──────────────────────────────────────────────────

const HELP_TEXT = `可用命令：

⚡ 快速执行（不走 Claude）：
  /s /status    git status + 最近提交
  /d /diff      git diff
  /l /log       git log
  /b /branch    分支列表
  /pwd          当前目录 + 文件列表
  /ps           运行中的进程

💬 Claude 快捷方式：
  /review           代码 review
  /fix              修复报错
  /doc              生成/更新文档
  /test [文件]      生成单测
  /explain [文件]   解释代码
  /refactor [文件]  重构
  /commit           生成 commit message
  /pr               生成 PR 描述
  /todo             整理 TODO 清单
  /summary          生成工作日报
  /bsx [内容]       头脑风暴，不动代码
  /upmd             更新 README.md 和 CLAUDE.md
  /build [命令]     构建项目
  /install          安装依赖
  /run [script]     运行 npm script

📁 多文件模式：
  /mf start         开始多文件模式
  /mf done          结束并发送所有文件

自定义命令在 ~/.larkcc/config.yml 的 commands 块配置。`;

// ── 主处理函数 ────────────────────────────────────────────────

export interface CommandResult {
  type: "exec" | "prompt" | "unknown" | "help" | "multifile_start" | "multifile_done" | "exec_confirm";
  output?: string;
  prompt?: string;
  cmd?: string;        // 待确认的命令（exec_confirm 时使用）
}

export interface CommandContext {
  customCommands: Record<string, string>;      // 用户 PROMPT 命令
  execCommands: Record<string, string>;        // 用户 EXEC 命令
  execSecurity: ExecSecurity;                  // 安全配置
}

export function parseCommand(
  text: string,
  cwd: string,
  context: CommandContext
): CommandResult | null {
  if (!text.startsWith("/")) return null;

  const parts = text.slice(1).trim().split(/\s+/);
  const cmd   = parts[0].toLowerCase();
  const args  = parts.slice(1).join(" ");

  if (cmd === "help" || cmd === "h") {
    return { type: "help", output: HELP_TEXT };
  }

  // 多文件模式命令
  if (cmd === "mf") {
    const subCmd = args.toLowerCase().trim();
    if (subCmd === "start") {
      return { type: "multifile_start" };
    } else if (subCmd === "done" || subCmd === "end") {
      return { type: "multifile_done" };
    } else {
      return {
        type: "unknown",
        output: `未知多文件命令 /mf ${subCmd}，可用：/mf start, /mf done`,
      };
    }
  }

  // 1. 内置 EXEC 命令（优先级最高，不可覆盖）
  if (BUILTIN_EXEC[cmd]) {
    logger.info(`Running /${cmd}...`);
    const output = BUILTIN_EXEC[cmd](cwd);
    return { type: "exec", output };
  }

  // 2. 用户自定义 EXEC 命令
  if (context.execCommands[cmd]) {
    const template = context.execCommands[cmd];
    const resolvedCmd = parseTemplate(template, args);

    // 安全检查
    const securityResult = checkExecSecurity(resolvedCmd, context.execSecurity);

    if (securityResult.needsConfirm) {
      return {
        type: "exec_confirm",
        cmd: resolvedCmd,
        output: securityResult.reason,
      };
    }

    if (!securityResult.safe) {
      return {
        type: "unknown",
        output: `❌ 命令被阻止: ${securityResult.reason}`,
      };
    }

    logger.info(`Running custom exec /${cmd}: ${resolvedCmd}`);
    const output = runCmd(resolvedCmd, cwd);
    return { type: "exec", output };
  }

  // 3. 用户自定义 PROMPT 命令（覆盖内置）
  if (context.customCommands[cmd]) {
    const template = context.customCommands[cmd];
    const prompt = template.includes("{input}")
      ? template.replace("{input}", args || "")
      : (args ? `${template}\n补充信息：${args}` : template);
    return { type: "prompt", prompt };
  }

  // 4. 内置 PROMPT 命令（从配置文件加载）
  if (DEFAULT_PROMPTS[cmd]) {
    let prompt = DEFAULT_PROMPTS[cmd];

    // 处理带参数的命令
    if (cmd === "test" || cmd === "explain" || cmd === "refactor") {
      if (args) {
        if (cmd === "test") prompt = `为 ${args} 生成完整的单元测试`;
        if (cmd === "explain") prompt = `详细解释 ${args} 的作用、逻辑和关键设计决策`;
        if (cmd === "refactor") prompt = `重构 ${args}，提升可读性、性能和可维护性，保持功能不变`;
      }
    } else if (cmd === "bsx") {
      prompt = args ? `${prompt}\n\n${args}` : prompt;
    } else if (cmd === "build") {
      const pm = detectPkgManager(cwd);
      const buildCmd = pm === "cargo" ? "cargo build" : `${pm} run build`;
      prompt = args ? `运行构建命令：${args}` : `运行项目构建命令 \`${buildCmd}\`，如有报错帮我修复`;
    } else if (cmd === "install") {
      const pm = detectPkgManager(cwd);
      prompt = `运行 \`${pm} install\` 安装依赖，如有问题帮我解决`;
    } else if (cmd === "run") {
      const pm = detectPkgManager(cwd);
      prompt = args ? `运行 \`${pm} run ${args}\`，如有报错帮我修复` : `列出 package.json 中可用的 scripts 并帮我选择`;
    }

    return { type: "prompt", prompt };
  }

  return {
    type: "unknown",
    output: `未知命令 /${cmd}，发送 /help 查看可用命令`,
  };
}
