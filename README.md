# larkcc

[![npm version](https://badge.fury.io/js/larkcc.svg)](https://badge.fury.io/js/larkcc)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Claude Code in Feishu — 在任意项目目录启动，通过飞书机器人与 Claude 对话，体验等同于终端直接使用 Claude Code。

## 安装

```bash
npm install -g larkcc
```

### 从源码安装

```bash
git clone https://github.com/suj1e/larkcc.git
cd larkcc
chmod +x install.sh
./install.sh
```

## 快速开始

```bash
# 1. 配置默认机器人（只需填 App ID 和 Secret）
larkcc --setup

# 2. 在你的项目目录启动
cd /your/project
larkcc

# 3. 给机器人发任意一条消息，自动检测并保存你的 open_id
# ✅ Auto-detected open_id: ou_xxx
# 之后就可以正常使用了
```

## 命令

```bash
# 常用
larkcc                     # 启动（默认机器人，新会话）
larkcc -c                  # 继续上次会话
larkcc -p mybot            # 使用指定 profile
larkcc -d                  # 后台运行
larkcc --setup             # 配置机器人
larkcc --help              # 查看所有命令
```

## 群聊支持

可以把多个机器人拉进同一个飞书群，通过 @ 或引用回复来分别控制：

```
群：你 + 机器人A(tiz项目) + 机器人B(larkcc项目) + 机器人C + 机器人D

你：@机器人A 帮我分析登录模块
机器人A：好的，我来看 tiz 项目的登录模块...

你：@机器人B 帮我看 agent.ts
机器人B：好的，我来看 larkcc 的 agent.ts...

你：[引用机器人A的回复] 这个问题怎么修？
机器人A：续接上次对话继续回复...
```

**触发规则：**
- 群消息：@ 机器人 或 引用机器人的消息 才会触发
- 单聊：直接发消息即可

**会话说明：**
- 单聊和群聊共用同一个 Claude session
- 无论在哪里发消息，Claude 都能记住上下文

**飞书权限需要额外添加：**
- `im:message.group_at_msg:readonly` — 接收群 @ 消息

## Slash 命令

在飞书发送 `/命令` 可以快速执行操作：

### ⚡ 快速执行（不走 Claude，秒返回）

| 命令 | 说明 |
|------|------|
| `/stop` `/cancel` | **中断当前任务** |
| `/s` `/status` | git status + 最近提交 |
| `/d` `/diff` | git diff |
| `/l` `/log` | git log |
| `/b` `/branch` | 分支列表 |
| `/pwd` | 当前目录 + 文件列表 |
| `/ps` | 运行中的进程 |

### 💬 Claude 快捷方式

| 命令 | 说明 |
|------|------|
| `/review` | 代码 review |
| `/fix` | 修复报错 |
| `/doc` | 生成/更新 README |
| `/test [文件]` | 生成单元测试 |
| `/explain [文件]` | 解释代码 |
| `/refactor [文件]` | 重构 |
| `/commit` | 生成 commit message |
| `/pr` | 生成 PR 描述 |
| `/todo` | 整理 TODO 清单 |
| `/summary` | 生成工作日报 |
| `/bsx [内容]` | 头脑风暴，不动代码 |
| `/quality [路径]` | 代码质量检查（类型/错误/简洁/性能） |
| `/release [类型]` | 生成 CHANGELOG + 执行 release.sh |
| `/check` | 综合检查（类型/lint/测试） |
| `/security` | 安全漏洞扫描 |
| `/deps` | 检查过期依赖 |
| `/upmd` | 更新 README.md 和 CLAUDE.md |
| `/build` | 构建项目 |
| `/install` | 安装依赖 |
| `/run [script]` | 运行 npm script |
| `/help` | 查看所有命令 |

### 📁 多文件模式

| 命令 | 说明 |
|------|------|
| `/mf start` | 开始多文件模式 |
| `/mf done` | 结束并发送所有缓存的文件 |

### 自定义命令

```yaml
# ~/.larkcc/config.yml
commands:
  # 基础用法
  deploy: "按标准流程部署到测试环境，部署前先跑测试"
  standup: "总结今天的代码改动，生成简洁日报"

  # 使用 {input} 模板占位符
  impl: "直接实现以下需求，不要讨论：\n\n{input}"
  check: "只检查不修改，分析以下内容：\n\n{input}"
```

**用法：**
```
/impl 实现用户登录功能
→ 直接实现以下需求，不要讨论：
→ 实现用户登录功能
```

**占位符说明：**
- `{input}` - 用户输入的参数（推荐）
- 不使用占位符时，参数会以 `补充信息：xxx` 形式附加

### 自定义 EXEC 命令

除了 PROMPT 命令，还可以定义直接执行的命令（不走 Claude）：

```yaml
# ~/.larkcc/config.yml
exec_commands:
  docker: "docker ps -a"
  dc: "docker-compose {{args}}"
  kp: "kubectl get pods -n {{namespace|default}}"
  logs: "tail -n {{n|100}} {{file}}"
```

**模板语法：**
- `{{args}}` - 所有参数
- `{{param}}` - 按顺序取参数
- `{{param|default}}` - 可选参数，有默认值

**用法：**
```
/docker          → docker ps -a
/dc up -d        → docker-compose up -d
/kp production   → kubectl get pods -n production
/logs 50 app.log → tail -n 50 app.log
/logs app.log    → tail -n 100 app.log（使用默认值）
```

### EXEC 安全控制

为防止误执行危险命令，支持安全检查：

```yaml
# ~/.larkcc/config.yml
exec_security:
  enabled: true
  blacklist:
    - "rm -rf"
    - "rm -r"
    - "sudo"
    - "mkfs"
    - "dd if="
    - "> /dev/"
    - "chmod 777"
    - "chmod -R"
    - "chown -R"
    - "shutdown"
    - "reboot"
  confirm_on_warning: true
```

**说明：**
- `enabled: true` - 启用安全检查（默认启用）
- `blacklist` - 危险关键词列表
- `confirm_on_warning: true` - 检测到危险命令时需用户确认

**确认流程：**
```
你：/mycmd some dangerous command
Bot: ⚠️ 危险命令检测
     检测到危险关键词: rm -rf
     命令：rm -rf /some/path
     确认执行？回复 y 确认，回复 n 取消
你：y
Bot: ✅ 已执行
```

## 任务控制

```
你：帮我重构整个项目...
你：/stop  → ⏹ 已发送中断信号
```

任务超过 10 分钟无响应自动释放锁，无需重启。

## 图片支持

支持多种图片发送方式，Claude 自动分析：

```
你：[截图] 帮我实现这个界面
你：[报错截图] 这个怎么修
你：[富文本含多图] 分析这几张图
```

- 单独图片消息
- 富文本消息中的图片（支持多图）
- 混合文字+图片

## 文件支持

支持发送文件给 Claude 分析：

```
你：[文件 data.xlsx] 分析这个数据
Claude：我来读取这个文件...
```

### 单文件模式

直接发送文件，Claude 自动读取并分析。

### 多文件模式

当需要同时分析多个文件时，使用多文件模式：

```
你：/mf start
Claude：📁 多文件模式已开始，请发送文件和说明文字，完成后发送 /mf done

你：[文件 report.xlsx]
你：[文件 data.csv]
你：对比分析这两个数据

你：/mf done
Claude：好的，我来分析这 2 个文件...
```

**命令：**

| 命令 | 说明 |
|------|------|
| `/mf start` | 开始多文件模式（重复发送会重置） |
| `/mf done` | 结束并发送所有缓存的文件 |

**超时：** 默认 5 分钟超时，超时后需要重新 `/mf start`

**临时文件清理：**

```bash
# 清理当前 profile 的临时文件
larkcc --cleanup-tmp-files

# 清理超过 24 小时的文件
larkcc --cleanup-tmp-files --older-than 24

# 清理所有 profile 的临时文件
larkcc --cleanup-tmp-files --cleanup-all
```

临时文件目录：`~/.larkcc/temp/{profile}/`

## 多机器人

```bash
larkcc --new-profile        # 新增机器人
larkcc --list-profiles      # 查看所有机器人
larkcc -p mybot             # 使用指定机器人
```

### Open ID 自动检测

setup 不需要填 open_id，发第一条消息自动保存。

### 重复启动检测

同一机器人在其他项目运行时提示确认，避免意外顶掉。

## 飞书侧体验

- ✅ 启动/断开通知
- 👌 处理中打 reaction，完成换 DONE
- 💬 回复引用原消息
- ⚡ 工具调用实时展示
- 🌊 流式输出（互斥守卫 + 自适应节流 + 长间隔批处理）
- 📋 Markdown 卡片渲染（自动标题降级适配）
- 📄 超长消息支持分段发送或写入云文档
- 🛡️ 文档写入容错（单表/批次失败不影响整篇文档）
- 🎯 格式指导注入（从源头优化输出质量）
- 🖼 图片理解（支持富文本多图）
- 🧠 思考过程分离（可折叠显示 Claude 的推理过程）
- ⏱ 响应元数据（耗时、token 数实时显示）
- 🖼 外部图片自动上传（下载 → 飞书 → 渲染，支持卡片和文档）
- ⌨️ Slash 命令
- ⏹ `/stop` 中断任务
- 👥 群聊 @ 触发

## Markdown 扩展语法

除了标准 Markdown，还支持以下扩展语法：

### 文本样式

```markdown
<u>下划线文本</u>

<span style="color:red">红色文字</span>
<span style="color:#FF0000">十六进制颜色</span>
<span style="background-color:yellow">高亮背景</span>
<span style="color:red;background-color:yellow">红色文字+黄色背景</span>
```

**颜色支持：**
- 颜色名称：`red`、`blue`、`green`、`yellow`、`orange`、`purple`、`pink`、`gray`、`black`、`white` 等
- 十六进制：`#FF0000`、`#00FF00`、`#0000FF` 等

### 表格对齐

```markdown
| 左对齐 | 居中 | 右对齐 |
| :---   | :--: | ---:   |
| 内容   | 内容 | 内容   |
```

### 表格合并

```markdown
| <td colspan="2">跨两列</td> | 第三列 |
| --- | --- | --- |
| A | B | C |

| <td rowspan="2">跨两行</td> | B1 |
| --- | --- |
| B2 | C2 |
```

### 转义

使用 `\` 转义特殊字符：

```markdown
\* 不是斜体 \*
\<u\> 显示为 <u>
```

## 流式输出

回复内容会以打字机效果逐字显示，无需等待完整输出。

内部使用 FlushController：
- **互斥守卫** — 防止并发刷新冲突
- **自适应节流** — 根据上次刷新时间动态调整间隔
- **长间隔批处理** — 2 秒无新内容自动 flush 剩余缓冲

### 配置

```yaml
streaming:
  enabled: true                # 是否启用流式（默认 true）
  mode: cardkit                # update（message.patch）| cardkit | none
  flush_interval_ms: 300       # 最小刷新间隔（毫秒）
  thinking_enabled: false      # 是否显示 Claude 思考过程
  fallback_on_error: true      # 失败时降级为一次性发送

# 卡片标题（所有模式生效）
card_title: Claude              # 留空则不显示 header

# 图片自动解析（下载外部图片上传到飞书）
image_resolver:
  enabled: true                # 是否启用（默认 true）
```

### 模式说明

| 模式 | 说明 | 额外权限 |
|------|------|---------|
| `update` | 使用消息 patch API 模拟流式 | 无（默认即可用） |
| `cardkit` | 使用飞书 CardKit API（真正打字机效果） | `cardkit:card:write` |
| `none` | 禁用流式，等待完整输出后一次性发送 | 无 |

- `cardkit` 模式为默认模式，采用单卡片架构（对齐飞书官方 OpenClaw 方案），全程只有一个消息
- `cardkit` 模式下工具调用不可见（不打工具卡片），失败时自动降级为 `update`
- `update` 模式使用消息 patch API 模拟流式，会发送独立的工具调用卡片
- 流式过程中如果内容超长，最终会自动写入云文档并回复链接

### 中断

流式输出过程中可以使用 `/stop` 中断，卡片会立即显示中断消息。

### 思考过程

开启 `streaming.thinking_enabled: true` 后，Claude 的扩展思考过程会以可折叠面板显示在回复上方：

- 流式期间显示 "💭 思考中..." 提示
- 完成后思考内容收起在折叠面板中，点击可展开查看
- 关闭时完全过滤 `<thinking>` 标签，用户无感

### 响应元数据

每条回复底部自动显示耗时和 token 用量：

```
⏱ 8.2s · 1,234 tokens
```

仅显示在卡片消息中，云文档不追加。

## 格式优化

### 卡片自动优化

发送到飞书卡片的 Markdown 会自动经过优化管线处理：

1. **标题降级** — H1→H4, H2-H6→H5（飞书卡片只支持 H4/H5）
2. **代码块保护** — 代码块内容不会被其他处理逻辑误解析
3. **外部图片上传** — 自动下载外部图片并上传到飞书，替换为 `img_xxx` 格式（卡片和文档均支持）

### 格式指导（System Prompt）

默认启用，通过 Claude Code SDK 的 system prompt 注入飞书格式规范，从源头提升输出质量。整个会话只需注入一次，不重复消耗 token。

```yaml
format_guide:
  enabled: true    # 是否启用（默认 true）
```

**自定义格式指导：**

编辑 `~/.larkcc/format-guide.md` 即可覆盖默认内容。格式指导内容是纯 Markdown，你可以根据实际需求增减规则。

查看默认格式指导：`resources/format-guide.md`（随项目发布）。

## 消息类型支持

| 类型 | 单聊 | 群聊 |
|------|------|------|
| 普通文本 | ✅ | ✅（需 @） |
| 富文本 | ✅ | ✅（需 @） |
| 富文本含图片 | ✅ | ✅（需 @） |
| 图片 | ✅ | ✅（需 @） |
| 引用回复 | ✅ | ✅ |

## 配置文件

`~/.larkcc/config.yml`：

```yaml
feishu:
  app_id: cli_xxxxxxxx
  app_secret: xxxxxxxxxxxxxxxx
  owner_open_id: ou_xxxxxxxx   # 首次收到消息后自动填入

claude:
  permission_mode: acceptEdits
  allowed_tools:
    - Read
    - Write
    - Edit
    - Bash
    - Glob
    - Grep
    - LS

# 超长消息处理配置
overflow:
  mode: document              # chunk（分片发送）或 document（写入云文档）
  chunk:
    threshold: 2800           # 分片阈值
  document:
    threshold: 2800           # 写文档阈值
    title_template: "{cwd} - {session_id} - {datetime}"

# 格式指导（从源头优化 Claude 输出质量）
format_guide:
  enabled: true               # 是否注入飞书格式要求到 prompt

# 卡片标题
card_title: Claude              # 留空则不显示 header

# 流式输出配置
streaming:
  enabled: true               # 是否启用流式（默认 true）
  mode: cardkit                # update | cardkit | none
  flush_interval_ms: 300      # 最小刷新间隔（毫秒）
  thinking_enabled: false     # 是否显示思考过程
  fallback_on_error: true     # 失败时降级

# 图片自动解析（下载外部图片上传到飞书）
image_resolver:
  enabled: true               # 是否启用（默认 true）

commands:
  deploy: "部署到测试环境"

# 图片消息默认提示词（只发图片时会自动添加）
image_prompt: "分析图片，给出回应"

# 文件处理配置
file:
  enabled: true                                              # 是否启用文件处理
  size_limit: 31457280                                       # 文件大小限制（bytes），默认 30MB
  temp_dir: "~/.larkcc/temp"                                 # 临时文件目录
  prompt: "分析文件 {filename}（路径：{filepath}，大小：{size}，类型：{mime_type}）"
  multifile_prompt: "分析以下 {count} 个文件：\n{files}\n\n用户说明：{text}"
  multifile_timeout: 300                                     # 多文件模式超时（秒）

# Reaction 表情配置
reaction:
  processing: Typing    # 处理中（默认 Typing 敲键盘）
  done: DONE            # 完成
  error: OnIt           # 出错

# 卡片标题
card_title: Claude

profiles:
  mybot:
    feishu:
      app_id: cli_bot_xxx
      app_secret: xxxxxxxxxxxxxxxx
```

### 超长消息处理

当回复内容超过阈值时，支持两种处理方式：

| 模式 | 说明 |
|------|------|
| `chunk` | 分片发送，每片带页码 |
| `document` | 写入飞书云文档，回复文档链接 |

**文档模式配置：**

在飞书开发者后台为应用开通以下**用户身份**权限：

| 权限 | 说明 |
|------|------|
| `docx:document` | 创建/编辑云文档 |
| `drive:file` | 删除云空间文件 |

开通后发布应用，文档会自动创建在您"我的空间"的`larkcc` 文件夹中。

**标题模板占位符：**
- `{cwd}` - 当前工作目录
- `{session_id}` - Claude 会话 ID
- `{datetime}` - 日期时间（2026-03-22 14:30:00）
- `{date}` - 日期（2026-03-22）
- `{profile}` - 机器人配置名

**文档结构：**

```
> 用户原始消息内容

──────────────────

📁 工作目录: /opt/dev/myproject
🤖 机器人: default
🔗 会话ID: abc123def456
📅 时间: 2026-03-22 14:30:00

──────────────────

（实际回复内容...）
```

- 支持 Markdown 格式（标题、代码块、列表等）

**图片处理：**

- `blob:` 格式的无效图片 URL 自动过滤
- 外部图片（`https://`）自动下载并上传到飞书，替换为内部 `img_xxx` 格式
- 上传失败的图片降级为链接，不影响整体流程
- 图片大小限制 10MB，下载超时 10 秒
- 卡片和云文档均支持图片渲染

**自动清理：**

创建新文档时，会自动清理超出数量的旧文档：

```yaml
overflow:
  mode: document
  document:
    threshold: 2800
    title_template: "{datetime}"
    cleanup:
      enabled: true       # 是否启用自动清理
      max_docs: 50        # 最大保留文档数（每个 profile 独立计算）
      notify: true        # 清理时是否通知
```

- 使用本地文档注册表追踪创建的文档（`~/.larkcc/doc-registry.json`）
- 每个 profile 独立管理，互不影响
- 按创建时间排序，保留最新的 `max_docs` 个文档
- 清理成功会在回复消息中附带通知
- 删除失败会忽略并继续，不影响正常流程

### 自定义 API

`~/.claude/settings.json`：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_BASE_URL": "https://ark.cn-beijing.volces.com/api/coding",
    "ANTHROPIC_MODEL": "ark-code-latest",
    "API_TIMEOUT_MS": "3000000"
  }
}
```

## 飞书开放平台配置

> ⚠️ 改完权限必须**创建新版本并发布**

### 权限

权限按功能分组，建议全部开通：

#### 基础消息（必开）

| 权限 | 用途 |
|------|------|
| `im:message` | 基础消息（含下载消息中的图片、文件） |
| `im:message:send_as_bot` | 以机器人身份发送消息、回复消息、更新消息（**流式输出也依赖此权限**） |
| `im:message.p2p_msg:readonly` | 接收私聊消息 |
| `im:message.group_at_msg:readonly` | 接收群 @ 消息 |
| `im:message.reactions:write_only` | 打 reaction 表情（处理中/完成/出错状态） |

#### 卡片与富文本

| 权限 | 用途 |
|------|------|
| `cardkit:card:write` | 发送交互式卡片、CardKit 流式输出 |

> 💡 `im:message` 权限已包含下载消息中资源文件（图片、文件）的能力

#### 云文档（超长消息写入）

| 权限 | 用途 |
|------|------|
| `docx:document` | 创建/编辑云文档（`overflow.mode: document` 时需要） |
| `drive:file` | 删除云空间文件（自动清理旧文档时需要） |

> 💡 不使用文档模式时，这两个权限可以不开

#### 开通步骤

1. 进入 [飞书开发者后台](https://open.feishu.cn/) → 选择你的应用
2. 左侧菜单 **权限管理** → 搜索并开通上述权限
3. 点击 **权限管理** 页面上方的 **权限配置** → 批量开通
4. 创建新版本 → 申请发布（企业自建应用管理员审批即可）
5. 发布成功后权限生效

> ⚠️ 权限变更后需要重新发布应用版本，已运行的 larkcc 需要重启

### 事件订阅

使用**长连接** → 订阅 `im.message.receive_v1`

## 状态文件

| 文件 | 说明 |
|------|------|
| `~/.larkcc/config.yml` | 配置 |
| `~/.larkcc/state.json` | 默认机器人状态 |
| `~/.larkcc/state-{profile}.json` | 各 profile 状态 |
| `~/.larkcc/lock-default.json` | 进程锁 |
| `~/.larkcc/lock-{profile}.json` | 各 profile 进程锁 |
| `~/.larkcc/doc-registry.json` | 默认 profile 文档注册表 |
| `~/.larkcc/doc-registry-{profile}.json` | 各 profile 文档注册表 |
| `~/.larkcc/temp/default/` | 默认 profile 临时文件目录 |
| `~/.larkcc/temp/{profile}/` | 各 profile 临时文件目录 |
| `~/.claude.json` | Claude onboarding（自动创建） |

---

## API 参考

- [飞书文档块 API](https://feishu.apifox.cn/doc-1950637) — 文档块类型、属性、代码语言枚举

## License

[MIT](LICENSE)

## Disclaimer

This project is not officially affiliated with Lark, Feishu, or ByteDance.

---

# English Documentation

Claude Code in Feishu/Lark — Start in any project directory, chat with Claude via Feishu bot, experience equivalent to using Claude Code directly in terminal.

## Installation

```bash
npm install -g larkcc
```

### Install from Source

```bash
git clone https://github.com/suj1e/larkcc.git
cd larkcc
chmod +x install.sh
./install.sh
```

## Quick Start

```bash
# 1. Configure default bot (only need App ID and Secret)
larkcc --setup

# 2. Start in your project directory
cd /your/project
larkcc

# 3. Send any message to the bot, it will auto-detect and save your open_id
# ✅ Auto-detected open_id: ou_xxx
# Now you can use it normally
```

## Commands

```bash
# Common
larkcc                     # Start (default bot, new session)
larkcc -c                  # Continue last session
larkcc -p mybot            # Use specified profile
larkcc -d                  # Run in background
larkcc --setup             # Configure bot
larkcc --help              # View all commands
```

## Group Chat Support

Add multiple bots to the same Feishu group, control them via @ mentions or reply:

```
Group: You + BotA(project A) + BotB(project B)

You: @BotA Help me analyze the login module
BotA: OK, let me check project A's login module...

You: @BotB Help me check agent.ts
BotB: OK, let me check project B's agent.ts...

You: [Reply to BotA's message] How to fix this issue?
BotA: Continue from previous conversation...
```

**Trigger rules:**
- Group message: @ bot or reply to bot's message to trigger
- Direct message: Just send message directly

**Session:**
- Direct chat and group chat share the same Claude session
- Claude remembers context regardless of where you send message

**Additional Feishu permission required:**
- `im:message.group_at_msg:readonly` — Receive group @ messages

## Slash Commands

Send `/command` in Feishu for quick actions:

### ⚡ Quick Execute (No Claude, instant return)

| Command | Description |
|---------|-------------|
| `/stop` `/cancel` | **Interrupt current task** |
| `/s` `/status` | git status + recent commits |
| `/d` `/diff` | git diff |
| `/l` `/log` | git log |
| `/b` `/branch` | Branch list |
| `/pwd` | Current directory + file list |
| `/ps` | Running processes |

### 💬 Claude Shortcuts

| Command | Description |
|---------|-------------|
| `/review` | Code review |
| `/fix` | Fix errors |
| `/doc` | Generate/update README |
| `/test [file]` | Generate unit tests |
| `/explain [file]` | Explain code |
| `/refactor [file]` | Refactor |
| `/commit` | Generate commit message |
| `/pr` | Generate PR description |
| `/todo` | Organize TODO list |
| `/summary` | Generate daily report |
| `/bsx [content]` | Brainstorm without code changes |
| `/quality [path]` | Code quality check (types/errors/simplicity/perf) |
| `/release [type]` | Generate CHANGELOG + run release.sh |
| `/check` | Comprehensive check (types/lint/test) |
| `/security` | Security vulnerability scan |
| `/deps` | Check outdated dependencies |
| `/upmd` | Update README.md and CLAUDE.md |
| `/build` | Build project |
| `/install` | Install dependencies |
| `/run [script]` | Run npm script |
| `/help` | View all commands |

### Custom Commands

```yaml
# ~/.larkcc/config.yml
commands:
  deploy: "Deploy to test environment following standard process"
  impl: "Implement the following directly without discussion:\n\n{input}"
```

### Custom EXEC Commands

Define commands that execute directly (without Claude):

```yaml
# ~/.larkcc/config.yml
exec_commands:
  docker: "docker ps -a"
  dc: "docker-compose {{args}}"
  logs: "tail -n {{n|100}} {{file}}"
```

**Template syntax:**
- `{{args}}` - All arguments
- `{{param}}` - Parameter by position
- `{{param|default}}` - Optional with default value

### EXEC Security Control

```yaml
exec_security:
  enabled: true
  blacklist:
    - "rm -rf"
    - "sudo"
    - "mkfs"
  confirm_on_warning: true
```

## Image Support

Supports multiple image sending methods, Claude auto-analyzes:

```
You: [Screenshot] Help me implement this UI
You: [Error screenshot] How to fix this
You: [Rich text with multiple images] Analyze these images
```

> **Note:** Invalid image URLs (like `blob:` URLs from websearch) are automatically filtered. External images are automatically downloaded and uploaded to Feishu for proper rendering.

## File Support

Send files to Claude for analysis:

```
You: [File data.xlsx] Analyze this data
Claude: Let me read this file...
```

## Extended Markdown Syntax

Beyond standard Markdown, the following extensions are supported:

### Text Styles

```markdown
<u>Underline text</u>

<span style="color:red">Red text</span>
<span style="color:#FF0000">Hex color</span>
<span style="background-color:yellow">Highlighted background</span>
<span style="color:red;background-color:yellow">Red text + yellow background</span>
```

**Color support:**
- Color names: `red`, `blue`, `green`, `yellow`, `orange`, `purple`, `pink`, `gray`, `black`, `white`, etc.
- Hexadecimal: `#FF0000`, `#00FF00`, `#0000FF`, etc.

### Table Alignment

```markdown
| Left | Center | Right |
| :--- | :----: | ----: |
| A    | B      | C     |
```

### Table Cell Merging

```markdown
| <td colspan="2">Span 2 columns</td> | Col 3 |
| --- | --- | --- |
| A   | B   | C   |

| <td rowspan="2">Span 2 rows</td> | B1 |
| --- | --- |
| B2  | C2 |
```

### Escaping

Use `\` to escape special characters:

```markdown
\* not italic \*
\<u\> displays as <u>
```

## Multi-Bot Support

```bash
larkcc --new-profile        # Add new bot
larkcc --list-profiles      # List all bots
larkcc -p mybot             # Use specified bot
```

## Feishu Open Platform Configuration

> ⚠️ After changing permissions, you must **create a new version and publish**

### Permissions

#### Basic Messaging (Required)

| Permission | Purpose |
|------------|---------|
| `im:message` | Basic message (including image/file download) |
| `im:message:send_as_bot` | Send/reply/update messages (**streaming also depends on this**) |
| `im:message.p2p_msg:readonly` | Receive direct messages |
| `im:message.group_at_msg:readonly` | Receive group @ messages |
| `im:message.reactions:write_only` | Add reactions (processing/done/error status) |

#### Cards

| Permission | Purpose |
|------------|---------|
| `cardkit:card:write` | Send interactive cards, CardKit streaming |

#### Cloud Documents (for overflow mode)

| Permission | Purpose |
|------------|---------|
| `docx:document` | Create/edit cloud documents (when `overflow.mode: document`) |
| `drive:file` | Delete cloud files (auto-cleanup of old documents) |

### Event Subscription

Use **Long Connection** → Subscribe to `im.message.receive_v1`

## 致谢

CardKit 流式卡片实现参考了飞书官方 [openclaw-lark](https://github.com/larksuite/openclaw-lark) 项目的 API 用法与架构设计。

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

## API Reference

- [Feishu Document Block API](https://feishu.apifox.cn/doc-1950637) — Block types, properties, code language enum