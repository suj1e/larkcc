import { execSync } from "child_process";
import fs from "fs";
import { logger } from "./logger.js";

function detectPkgManager(cwd: string): string {
  if (fs.existsSync(`${cwd}/pnpm-lock.yaml`)) return "pnpm";
  if (fs.existsSync(`${cwd}/yarn.lock`)) return "yarn";
  if (fs.existsSync(`${cwd}/Cargo.toml`)) return "cargo";
  return "npm";
}

function runCmd(cmd: string, cwd: string): string {
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

// ── 内置 Claude prompt 快捷方式 ──────────────────────────────

export const BUILTIN_PROMPTS: Record<string, (args: string, cwd: string) => string> = {
  "review":   (_, __)    => "帮我 review 最近的 git diff，关注安全性、性能、代码质量，给出具体改进建议",
  "fix":      (_, __)    => "分析项目最近的报错日志或测试失败，找到根本原因并修复",
  "doc":      (_, __)    => "为当前项目生成或更新 README，包括项目介绍、安装、使用方法",
  "test":     (args, __) => args ? `为 ${args} 生成完整的单元测试` : "为最近修改的文件生成单元测试",
  "explain":  (args, __) => args ? `详细解释 ${args} 的作用、逻辑和关键设计决策` : "解释当前项目的整体架构",
  "refactor": (args, __) => args ? `重构 ${args}，提升可读性、性能和可维护性，保持功能不变` : "找出项目中最需要重构的部分并重构",
  "commit":   (_, __)    => "分析当前 git diff，生成符合 Conventional Commits 规范的 commit message，直接输出，不要解释",
  "pr":       (_, __)    => "基于当前分支的改动，生成详细的 PR 描述，包括改动说明、测试方案、注意事项",
  "todo":     (_, __)    => "扫描项目里所有的 TODO、FIXME、HACK 注释，整理成优先级清单并给出建议",
  "summary":  (_, __)    => "总结今天的代码改动，生成简洁的工作日报",
  "bsx":      (args, __) => {
    const prompt = "先不动代码，我们头脑风暴，深度讨论方案与规划，并给出你需要确认的。";
    return args ? `${prompt}\n\n${args}` : prompt;
  },
  "upmd":     (_, __)    => "更新 README.md（如果存在，如果不存在就新增）和 CLAUDE.md（如果存在）。确保文档与代码保持同步，包括：功能描述、使用方法、配置说明等。",
  "build":    (args, cwd) => {
    const pm = detectPkgManager(cwd);
    const cmd = pm === "cargo" ? "cargo build" : `${pm} run build`;
    return args ? `运行构建命令：${args}` : `运行项目构建命令 \`${cmd}\`，如有报错帮我修复`;
  },
  "install":  (_, cwd)   => {
    const pm = detectPkgManager(cwd);
    return `运行 \`${pm} install\` 安装依赖，如有问题帮我解决`;
  },
  "run":      (args, cwd) => {
    const pm = detectPkgManager(cwd);
    return args ? `运行 \`${pm} run ${args}\`，如有报错帮我修复` : `列出 package.json 中可用的 scripts 并帮我选择`;
  },
};

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
  type: "exec" | "prompt" | "unknown" | "help" | "multifile_start" | "multifile_done";
  output?: string;
  prompt?: string;
}

export function parseCommand(
  text: string,
  cwd: string,
  customCommands: Record<string, string> = {}
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

  if (BUILTIN_EXEC[cmd]) {
    logger.info(`Running /${cmd}...`);
    const output = BUILTIN_EXEC[cmd](cwd);
    return { type: "exec", output };
  }

  if (BUILTIN_PROMPTS[cmd]) {
    const prompt = BUILTIN_PROMPTS[cmd](args, cwd);
    return { type: "prompt", prompt };
  }

  if (customCommands[cmd]) {
    const template = customCommands[cmd];
    const prompt = template.includes("{input}")
      ? template.replace("{input}", args || "")
      : (args ? `${template}\n补充信息：${args}` : template);
    return { type: "prompt", prompt };
  }

  return {
    type: "unknown",
    output: `未知命令 /${cmd}，发送 /help 查看可用命令`,
  };
}