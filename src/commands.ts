import { execSync } from "child_process";
import fs from "fs";
import { DEFAULT_PROMPTS } from "./commands/default-prompts.js";
import { logger } from "./logger.js";
import type { ExecSecurity } from "./config.js";

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

function buildHelpText(customCommands?: Record<string, string>): string {
  // EXEC 快捷命令（从 BUILTIN_EXEC 提取，只显示长名）
  const execNames = [...new Set(Object.values(BUILTIN_EXEC).map(fn => {
    return Object.entries(BUILTIN_EXEC).filter(([, f]) => f === fn).map(([k]) => k);
  }).flat())].filter(k => k.length > 1);

  const execLines = execNames.map(k => {
    const aliases = Object.entries(BUILTIN_EXEC)
      .filter(([name, fn]) => fn === BUILTIN_EXEC[k] && name !== k)
      .map(([name]) => `/${name}`);
    const aliasStr = aliases.length > 0 ? `、${aliases.join('、')}` : '';
    const desc = k === 'status' ? 'git status + 最近提交'
      : k === 'diff' ? 'git diff'
      : k === 'log' ? 'git log'
      : k === 'branch' ? '分支列表'
      : k === 'pwd' ? '当前目录 + 文件列表'
      : k === 'ps' ? '运行中的进程'
      : k;
    return `  /${k}${aliasStr}    ${desc}`;
  }).join('\n');

  // PROMPT 命令（从 default-prompts.yml + 用户自定义合并）
  const allPromptCmds = [
    ...Object.keys(DEFAULT_PROMPTS),
    ...(customCommands ? Object.keys(customCommands) : []),
  ].filter((v, i, a) => a.indexOf(v) === i);

  const promptLines = allPromptCmds.map(k => `  /${k}`).join('\n');

  return `可用命令：

⚡ 快速执行（不走 Claude）：
${execLines}

💬 Claude 快捷方式：
${promptLines}

📁 多文件模式：
  /mf start         开始多文件模式
  /mf done          结束并发送所有文件

自定义命令在 ~/.larkcc/config.yml 的 commands 块配置。`;
}

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
    return { type: "help", output: buildHelpText(context.customCommands) };
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
