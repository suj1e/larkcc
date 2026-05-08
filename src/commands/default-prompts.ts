export const DEFAULT_PROMPTS: Record<string, string> = {
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
