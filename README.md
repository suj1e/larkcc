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
larkcc --new-profile            # 新增机器人（引导填写，支持自定义或自动命名）
larkcc --list-profiles          # 查看所有已配置的机器人

# Session 管理
larkcc --reset-session          # 清除默认机器人的 session
larkcc -p mybot --reset-session # 清除 mybot 机器人的 session
```

## 多机器人支持

每个机器人是一个 profile，按名字区分：

```bash
# 新增机器人
larkcc --new-profile
# ? Feishu App ID: cli_bot_xxx
# ? Feishu App Secret: xxxxxxxx
# ? Profile name (blank to auto-generate): mybot
# ✅ Profile "mybot" saved
# → Send any message to the bot to auto-detect your open_id

# 查看所有机器人
larkcc --list-profiles
# Available profiles:
#   default          cli_a93e...  (default)
#   mybot            cli_bot_b...

# 使用指定机器人
larkcc -p mybot
```

### Open ID 自动检测

setup 时不需要手动填写 open_id，启动后发第一条消息给机器人即可自动检测并保存：

```
larkcc
ℹ  Owner: (pending first message)

← 发一条消息 →

✅ Auto-detected open_id: ou_xxx
✅ Saving to config...
```

### 重复启动检测

如果同一个机器人已经在其他项目运行，启动时会提示：

```
⚠  Already running!
  PID:     12345
  Project: /other/project
  Started: 2026-03-16T09:30:00.000Z

  Continue anyway? (y/n):
```

选 `y` 强制接管，选 `n` 退出。

## 飞书侧体验

- ✅ 启动时收到连接通知（含 profile 标签），断开时收到断开通知
- 👌 收到消息立即打 reaction 表示处理中，完成换成 DONE
- 💬 所有回复引用你的原始消息
- ⚡ 工具调用实时展示（读文件、执行命令等），完成后更新状态
- 📋 最终回复用富文本卡片渲染，支持 Markdown + 代码高亮
- 🔢 支持普通文本消息和富文本（post）消息，标题和正文都会识别

## 消息类型支持

| 消息类型 | 支持 |
|---------|------|
| 普通文本 | ✅ |
| 富文本（大输入框，带标题） | ✅ |
| 其他类型 | 忽略 |

## 配置文件

全局配置保存在 `~/.larkcc/config.yml`：

```yaml
feishu:                        # 默认机器人
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

profiles:                      # 其他机器人（可选）
  mybot:
    feishu:
      app_id: cli_bot_xxx
      app_secret: xxxxxxxxxxxxxxxx
      owner_open_id: ou_xxxxxxxx
```

### 环境变量

```bash
export LARKCC_APP_ID=cli_xxxxxxxx
export LARKCC_APP_SECRET=xxxxxxxxxxxxxxxx
export LARKCC_OWNER_OPEN_ID=ou_xxxxxxxx
```

### 自定义 API（火山引擎/其他兼容接口）

在 `~/.claude/settings.json` 配置，larkcc 启动时自动读取并注入：

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

> ⚠️ 每次修改权限或配置后，必须**创建新版本并发布**，否则更改不生效。

### 1. 创建应用

开放平台 → 创建应用 → 开启**机器人**能力

### 2. 权限配置

最小权限集：

| 权限 | 用途 |
|------|------|
| `im:message` | 基础消息权限 |
| `im:message:send_as_bot` | 机器人发送消息 |
| `im:message.p2p_msg:readonly` | 接收私聊消息（必须） |
| `im:message.reactions:write_only` | 打 reaction |
| `cardkit:card:write` | 发送卡片消息 |

### 3. 事件订阅

事件与回调 → 订阅方式选**使用长连接接收事件** → 添加事件 `im.message.receive_v1`

### 4. 发布应用

创建版本 → 发布（企业自建应用直接发布，无需审核）

### 获取你的 Open ID

启动 larkcc 后给机器人发任意一条消息，会自动检测并保存到配置文件，无需手动填写。

## 状态文件

| 文件 | 说明 |
|------|------|
| `~/.larkcc/config.yml` | 飞书和 Claude 配置（含所有 profiles） |
| `~/.larkcc/state.json` | 默认机器人的 chat_id 和 session_id |
| `~/.larkcc/state-{profile}.json` | 各 profile 的 chat_id 和 session_id |
| `~/.larkcc/lock-default.json` | 默认机器人的进程锁 |
| `~/.larkcc/lock-{profile}.json` | 各 profile 的进程锁 |
| `~/.claude.json` | Claude onboarding 状态（自动创建） |

## 工具展示

| 工具 | 展示 |
|------|------|
| Read | 📂 读取文件 |
| Write | ✏️ 写入文件 |
| Edit | ✏️ 编辑文件 |
| Bash | ⚡ 执行命令 |
| Glob | 🔍 查找文件 |
| Grep | 🔎 搜索内容 |
| LS | 📁 列出目录 |
| AskUserQuestion | 💬 直接发问题给你 |
| ExitPlanMode / TodoWrite / TodoRead | 静默处理 |
| 其他未知工具 | 🔧 工具名（降级展示） |