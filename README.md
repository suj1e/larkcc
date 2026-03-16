# larkcc

Claude Code in Feishu — 在任意项目目录启动，通过飞书机器人与 Claude 对话，体验等同于终端直接使用 Claude Code。

## 安装

```bash
git clone <repo>
cd larkcc
chmod +x install.sh
./install.sh
```

## 使用

```bash
cd /your/project
larkcc
```

首次运行自动引导配置（Feishu App ID、App Secret、你的 Open ID）。

## 命令

```bash
# 启动
larkcc                        # 默认机器人，新会话
larkcc --continue             # 默认机器人，续接上次会话
larkcc -p mybot                 # 用 mybot 机器人
larkcc -p mybot --continue      # 用 mybot 机器人，续接上次会话
larkcc -d                     # 后台运行

# 配置
larkcc --setup                # 配置/更新默认机器人
larkcc --setup -p mybot         # 配置/更新 mybot 机器人
larkcc --new-profile          # 新增机器人（引导填写，支持自定义或自动命名）
larkcc --list-profiles        # 查看所有已配置的机器人

# Session 管理
larkcc --reset-session        # 清除默认机器人的 session
larkcc -p mybot --reset-session # 清除 mybot 机器人的 session
```

## 多机器人支持

每个机器人是一个 profile，按名字区分：

```bash
# 新增机器人
larkcc --new-profile
# ? Feishu App ID: cli_bot_xxx
# ? Feishu App Secret: xxxxxxxx
# ? Your Open ID: ou_xxx
# ? Profile name (blank to auto-generate): mybot
# ✅ Profile "mybot" saved

# 查看所有机器人
larkcc --list-profiles
# Available profiles:
#   default          cli_a93e...  (default)
#   mybot              cli_bot_b...

# 使用指定机器人
larkcc -p mybot
```

所有状态（session、chat_id）按 profile 隔离：
```
~/.larkcc/state.json          # 默认机器人
~/.larkcc/state-mybot.json      # mybot 机器人
```

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
  owner_open_id: ou_xxxxxxxx

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

profiles:                      # 其他机器人
  mybot:
    feishu:
      app_id: cli_bot_mybot
      app_secret: xxxxxxxxxxxxxxxx
      owner_open_id: ou_xxxxxxxx
  work:
    feishu:
      app_id: cli_bot_work
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

1. 创建应用 → 开启**机器人**能力
2. 权限管理 → 开通以下权限：
   - `im:message`
   - `im:message:send_as_bot`
   - `im:message.reactions:write_only`
3. 事件订阅 → 使用**长连接**接收事件 → 订阅 `im.message.receive_v1`
4. 发布应用

### 获取你的 Open ID

启动 larkcc 后给机器人发任意一条消息，日志中会打印出 `ou_xxx`，填入配置的 `owner_open_id`。

## 状态文件

| 文件 | 说明 |
|------|------|
| `~/.larkcc/config.yml` | 飞书和 Claude 配置（含所有 profiles） |
| `~/.larkcc/state.json` | 默认机器人的 chat_id 和 session_id |
| `~/.larkcc/state-{profile}.json` | 各 profile 的 chat_id 和 session_id |
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