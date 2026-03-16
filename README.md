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
larkcc                  # 启动（前台，新会话）
larkcc --continue       # 启动，续接上次 Claude 会话
larkcc -c               # 同上，简写
larkcc -d               # 后台运行
larkcc --setup          # 重新配置
larkcc --reset-session  # 清除已保存的 Claude session
larkcc --version
```

## 飞书侧体验

- ✅ 启动时飞书收到连接通知，断开时收到断开通知
- 👌 收到消息立即打 reaction 表示处理中，完成换成 DONE
- 💬 所有回复引用你的原始消息
- ⚡ 工具调用实时展示（读文件、执行命令等）
- 📋 最终回复用富文本卡片渲染，支持 Markdown + 代码高亮

## 配置

全局配置保存在 `~/.larkcc/config.yml`：

```yaml
feishu:
  app_id: cli_xxxxxxxx
  app_secret: xxxxxxxxxxxxxxxx
  owner_open_id: ou_xxxxxxxx   # 只响应此用户的消息

claude:
  permission_mode: acceptEdits  # 自动接受文件修改
  allowed_tools:
    - Read
    - Write
    - Edit
    - Bash
    - Glob
    - Grep
    - LS
```

项目级配置可在项目根目录放 `.larkcc.yml` 覆盖全局配置。

优先级：`.larkcc.yml` > 环境变量 > `~/.larkcc/config.yml`

### 环境变量

```bash
export LARKCC_APP_ID=cli_xxxxxxxx
export LARKCC_APP_SECRET=xxxxxxxxxxxxxxxx
export LARKCC_OWNER_OPEN_ID=ou_xxxxxxxx
```

### 自定义 API（火山引擎/其他兼容接口）

在 `~/.claude/settings.json` 配置：

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

larkcc 启动时会自动读取此文件并注入环境变量。

## 飞书开放平台配置

1. 创建应用 → 开启**机器人**能力
2. 权限管理 → 开通以下权限：
   - `im:message`
   - `im:message:send_as_bot`
   - `im:message.reactions:write_only`
3. 事件订阅 → 使用**长连接**接收事件 → 订阅 `im.message.receive_v1`
4. 发布应用

### 获取你的 Open ID

启动 larkcc 后给机器人发任意一条消息，日志中会打印出 `ou_xxx`，填入 `~/.larkcc/config.yml` 的 `owner_open_id`。

## 状态文件

| 文件 | 说明 |
|------|------|
| `~/.larkcc/config.yml` | 飞书和 Claude 配置 |
| `~/.larkcc/state.json` | 持久化 chat_id 和 session_id |
| `~/.claude.json` | Claude onboarding 状态（自动创建） |