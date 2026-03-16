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
# ✅ Saving to config...

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
```

## Slash 命令

在飞书发送 `/命令` 可以快速执行操作：

### ⚡ 快速执行（不走 Claude，秒返回）

| 命令 | 说明 |
|------|------|
| `/s` `/status` | git status + 最近提交 |
| `/d` `/diff` | git diff |
| `/l` `/log` | git log |
| `/b` `/branch` | 分支列表 |
| `/pwd` | 当前目录 + 文件列表 |
| `/ps` | 运行中的进程 |

### 💬 Claude 快捷方式（展开为 prompt）

| 命令 | 说明 |
|------|------|
| `/review` | 代码 review（安全性、性能、质量） |
| `/fix` | 修复报错或测试失败 |
| `/doc` | 生成/更新 README |
| `/test [文件]` | 生成单元测试 |
| `/explain [文件]` | 解释代码逻辑 |
| `/refactor [文件]` | 重构代码 |
| `/commit` | 生成 Conventional Commits 格式的 commit message |
| `/pr` | 生成 PR 描述 |
| `/todo` | 整理 TODO/FIXME 清单 |
| `/summary` | 生成工作日报 |
| `/build [命令]` | 构建项目，报错自动修复 |
| `/install` | 安装依赖 |
| `/run [script]` | 运行 npm script |
| `/help` | 查看所有命令 |

### 自定义命令

在 `~/.larkcc/config.yml` 的 `commands` 块配置：

```yaml
commands:
  deploy: "按标准流程部署到测试环境，部署前先跑测试"
  standup: "总结今天的代码改动，生成简洁日报"
```

使用：`/deploy` 或 `/standup`

## 图片支持

直接发图片给机器人，Claude 会自动分析图片内容：

```
你：[截图] 帮我实现这个界面
你：[报错截图] 这个怎么修
你：[设计稿] 按这个写组件
```

## 多机器人支持

每个机器人是一个 profile：

```bash
larkcc --new-profile
# ? Feishu App ID: cli_bot_xxx
# ? Feishu App Secret: xxxxxxxx
# ? Profile name (blank to auto-generate): mybot
# ✅ Profile "mybot" saved

larkcc --list-profiles
# Available profiles:
#   default          cli_a93e...  (default)
#   mybot            cli_bot_b...

larkcc -p mybot
```

### Open ID 自动检测

setup 时不需要填 open_id，启动后发一条消息自动保存：

```
larkcc
ℹ  Owner: (pending first message)
← 发一条消息 →
✅ Auto-detected open_id: ou_xxx
```

### 重复启动检测

同一机器人在其他项目运行时会提示：

```
⚠  Already running!
  PID:     12345
  Project: /other/project
  Started: 2026-03-16T09:30:00.000Z

  Continue anyway? (y/n):
```

## 飞书侧体验

- ✅ 启动/断开时收到通知
- 👌 收到消息打 reaction，完成后换成 DONE
- 💬 所有回复引用你的原始消息
- ⚡ 工具调用实时展示
- 📋 最终回复 Markdown 卡片渲染
- 🖼 支持图片消息，Claude 直接分析
- ⌨️ 支持 `/命令` 快捷操作

## 消息类型支持

| 消息类型 | 支持 |
|---------|------|
| 普通文本 | ✅ |
| 富文本（大输入框，带标题） | ✅ |
| 图片 | ✅ |
| 其他类型 | 忽略 |

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

commands:                      # 自定义 slash 命令（可选）
  deploy: "部署到测试环境"
  standup: "生成工作日报"

profiles:                      # 其他机器人（可选）
  mybot:
    feishu:
      app_id: cli_bot_xxx
      app_secret: xxxxxxxxxxxxxxxx
```

### 自定义 API（火山引擎/其他兼容接口）

在 `~/.claude/settings.json` 配置，larkcc 启动时自动读取：

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

> ⚠️ 修改权限或配置后，必须**创建新版本并发布**，否则不生效。

### 权限

| 权限 | 用途 |
|------|------|
| `im:message` | 基础消息权限 |
| `im:message:send_as_bot` | 发送消息 |
| `im:message.p2p_msg:readonly` | 接收私聊消息 |
| `im:message.reactions:write_only` | 打 reaction |
| `cardkit:card:write` | 发送卡片消息 |

### 事件订阅

事件与回调 → 订阅方式选**使用长连接** → 添加事件 `im.message.receive_v1`

## 状态文件

| 文件 | 说明 |
|------|------|
| `~/.larkcc/config.yml` | 配置（含所有 profiles 和自定义命令） |
| `~/.larkcc/state.json` | 默认机器人的 chat_id 和 session_id |
| `~/.larkcc/state-{profile}.json` | 各 profile 的状态 |
| `~/.larkcc/lock-default.json` | 默认机器人的进程锁 |
| `~/.larkcc/lock-{profile}.json` | 各 profile 的进程锁 |
| `~/.claude.json` | Claude onboarding 状态（自动创建） |

## 工具展示

| 工具 | 展示 |
|------|------|
| Read | 📂 读取文件 |
| Write / Edit | ✏️ 写入/编辑文件 |
| Bash | ⚡ 执行命令 |
| Glob / Grep | 🔍 查找文件/搜索内容 |
| LS | 📁 列出目录 |
| AskUserQuestion | 💬 直接发问题给你 |
| ExitPlanMode / TodoWrite / TodoRead | 静默处理 |
| 其他 | 🔧 工具名（降级展示） |