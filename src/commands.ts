import { execSync } from "child_process";
import fs from "fs";
import { logger } from "./logger.js";
import type { ExecSecurity } from "./config.js";

// ── 内置 PROMPT 命令模板 ────────────────────────────────────

const DEFAULT_PROMPTS: Record<string, string> = {
  review:
    "帮我 review 最近的 git diff，关注安全性、性能、代码质量，给出具体改进建议",
  fix: "分析项目最近的报错日志或测试失败，找到根本原因并修复",
  doc: "为当前项目生成或更新 README，包括项目介绍、安装、使用方法",
  test: "为最近修改的文件生成单元测试",
  explain: "解释当前项目的整体架构",
  refactor: "找出项目中最需要重构的部分并重构",
  commit:
    "分析当前 git diff，生成符合 Conventional Commits 规范的 commit message，直接输出，不要解释",
  sync: `提交并推送代码到远程仓库。

步骤：
1. git add 所有变更
2. 生成 commit message（遵循 Conventional Commits）
3. git commit
4. git push

{input}
（有输入时直接用作 commit message，无输入时自动分析 diff 生成）`,
  pr: "基于当前分支的改动，生成详细的 PR 描述，包括改动说明、测试方案、注意事项",
  todo: "扫描项目里所有的 TODO、FIXME、HACK 注释，整理成优先级清单并给出建议",
  summary: "总结今天的代码改动，生成简洁的工作日报",
  bsx: "先不动代码，我们头脑风暴，深度讨论方案与规划，并给出你需要确认的。",
  build: "运行项目构建命令，如有报错帮我修复",
  install: "安装依赖，如有问题帮我解决",
  run: "列出 package.json 中可用的 scripts 并帮我选择",
  quality: `代码质量检查，按维度输出问题和修复建议。

检查维度：
- 类型安全：any 滥用、类型错误、断言风险
- 错误处理：异常捕获、边界情况、空值处理
- 代码简洁：重复代码、冗余逻辑、可读性
- 性能隐患：循环效率、内存泄漏、异步问题

目标：{input}
（无输入时检查 git diff 当前变更）

输出格式：
🔴 严重：...
🟡 警告：...
🟢 建议：...

最后给出 1-10 分整体评价和一句话总结。`,
  release: `基于 git diff 生成 CHANGELOG.md 变更内容，遵循 Keep a Changelog 格式。
然后执行 ./release.sh {input}。

{input} 可指定版本类型：patch / minor / major
无输入时自动分析变更规模：
- 只有文档/修复 → patch
- 有新功能 → minor
- 有 breaking change → major`,
  check: `综合检查项目：类型检查、lint、测试。
根据项目类型自动选择对应工具。

{input}`,
  security: `安全漏洞扫描，根据项目类型自动选择工具。

{input}`,
  deps: `检查过期依赖，根据项目类型自动选择工具。

{input}`,
  updeps: `依赖升级适配工具。分阶段执行，每个阶段等待用户确认。

{input} 可指定包名关键词过滤，如 \`/updeps claude\`，无输入则列出全部。

## Phase 1：概览

1. 运行 \`gh issue list --label deps-update --state open --json number,title,body\`
   如果没有 Issue，提示"当前没有待处理的依赖更新"并结束。
2. 如果有 {input}，按关键词过滤 Issue 标题。
3. 输出概览表格：

   | # | 依赖 | 当前 → 最新 | 类型 | 摘要 |
   |---|------|-------------|------|------|
   | 4 | claude-agent-sdk | 0.2.92 → 0.2.114 | patch | ... |

   摘要从 Issue body 的 Release Notes 部分提取，一句话概括最关键的变更。

4. 提示用户：选择要适配的 Issue 编号（多选用逗号），或输入 skip 跳过。
**不要执行任何代码修改或依赖更新，等待用户回复。**

## Phase 2：详细方案

用户选择后，对每个选中的依赖：

1. 读取 Issue body 中的 Release Notes
2. 在项目中搜索该依赖的 import/使用位置（grep 源码）
3. 对比当前版本和新版本的类型定义（如有 .d.ts）
4. 输出详细报告：

   #### 📦 {package} {old} → {new}

   **变更概要**
   - Breaking changes: ...
   - 新增特性（与本项目相关）: ...
   - 废弃 API: ...

   **受影响代码**
   - \`src/xxx.ts:行号\` — 用途说明
   - ...

   **适配方案**
   1. 具体步骤（如：将手写类型替换为 SDK 导出类型）
   2. ...
   3. ...

   **预期改动范围**: {影响文件数} 个文件

5. 提示用户：确认方案？可修改方案或跳过。
**不要执行任何代码修改，等待用户回复。**

## Phase 3：执行

用户确认后：

1. \`pnpm add {pkg}@{version}\` 更新依赖
2. 按适配方案修改代码
3. \`pnpm build\` 验证编译通过
4. 如果 build 失败：报告错误，修复后重试，最多 3 次
5. 汇报执行结果（改了哪些文件、build 状态）
6. 提示用户：确认 commit + push + 关闭 Issue？
**等待用户回复。**

用户确认 commit 后：
- git add + commit（message: \`deps: update {pkg} {old} → {new}\`）
- git push
- \`gh issue close #{n} --comment "已适配并发布"\` 关闭 Issue`,
  issues: `GitHub Issue 查看工具。拉取手动创建的 Issue 并生成报告，不包含自动依赖更新 Issue。

{input} 可指定关键词过滤标题，如 \`/issues bug\`，无输入则列出全部。

## 执行步骤

1. 运行 \`gh issue list --state open --json number,title,labels,body,created_at\`
2. 排除带 \`deps-update\` 标签的 Issue
3. 如果有 {input}，按关键词过滤 Issue 标题
4. 如果没有匹配的 Issue，提示"当前没有待处理的 Issue"并结束
5. 输出报告：

   | # | 标题 | 标签 | 创建时间 | 概要 |
   |---|------|------|----------|------|
   | 7 | 修复卡片渲染问题 | bug | 2026-04-18 | ... |

   概要从 Issue body 前几行提取，一句话概括。

6. 结束，不做任何代码修改。`,
};

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
