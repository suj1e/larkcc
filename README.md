# larkcc

Claude Code in Feishu — 在任意项目目录启动，通过飞书机器人与 Claude 对话，体验等同于终端直接使用 Claude Code。

## 安装

```bash
git clone <repo>
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
# 启动
larkcc                          # 默认机器人，新会话
larkcc --continue               # 默认机器人，续接上次会话
larkcc -p mybot                 # 用 mybot 机器人
larkcc -p mybot --continue      # 用 mybot 机器人，续接上次会话
larkcc -d                       # 后台运行

# 配置
larkcc --setup                  # 配置/更新默认机器人
larkcc --setup -p mybot         # 配置/更新 mybot 机器人
larkcc --new-profile            # 新增机器人
larkcc --list-profiles          # 查看所有已配置的机器人

# Session 管理
larkcc --reset-session          # 清除默认机器人的 session
larkcc -p mybot --reset-session # 清除 mybot 机器人的 session

# 进程管理
larkcc --ps                     # 查看运行中的 larkcc 进程
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
| `/build` | 构建项目 |
| `/install` | 安装依赖 |
| `/run [script]` | 运行 npm script |
| `/help` | 查看所有命令 |

### 自定义命令

```yaml
# ~/.larkcc/config.yml
commands:
  deploy: "按标准流程部署到测试环境，部署前先跑测试"
  standup: "总结今天的代码改动，生成简洁日报"
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
- 📋 Markdown 卡片渲染
- 📄 超长消息支持分段发送或写入云文档
- 🖼 图片理解（支持富文本多图）
- ⌨️ Slash 命令
- ⏹ `/stop` 中断任务
- 👥 群聊 @ 触发

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

commands:
  deploy: "部署到测试环境"

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

| 权限 | 用途 |
|------|------|
| `im:message` | 基础消息 |
| `im:message:send_as_bot` | 发送消息 |
| `im:message.p2p_msg:readonly` | 接收私聊 |
| `im:message.group_at_msg:readonly` | 接收群 @ 消息 |
| `im:message.reactions:write_only` | 打 reaction |
| `cardkit:card:write` | 发送卡片 |
| `docx:document` | 创建/编辑云文档（超长消息写入） |
| `drive:file` | 删除云空间文件（清理旧文档） |

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
| `~/.claude.json` | Claude onboarding（自动创建） |