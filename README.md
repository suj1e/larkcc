# larkcc

Claude Code in Feishu — chat with Claude via your Lark bot, in any project directory.

## Features

- Chat with Claude Code through Feishu/Lark messaging
- Claude operates in the directory where larkcc is started
- Real-time streaming text updates (simulated via throttled message updates)
- Tool call visualization with collapsible result previews
- Session persistence for conversation continuity
- Project-specific configuration support

## Install

```bash
git clone <repo>
cd larkcc
chmod +x install.sh
./install.sh
```

## Usage

```bash
cd /your/project
larkcc
```

First run will guide you through setup (Feishu App ID, App Secret, your Open ID).

## Commands

```bash
larkcc                  # start (foreground)
larkcc -d               # start in background (daemon mode)
larkcc --setup          # reconfigure ~/.larkcc/config.yml
larkcc --reset-session  # clear Claude session (start fresh conversation)
larkcc --whoami         # print your Feishu open_id (send any msg to bot first)
larkcc --version
```

## Config

Config is saved to `~/.larkcc/config.yml`:

```yaml
feishu:
  app_id: cli_xxxxxxxx
  app_secret: xxxxxxxxxxxxxxxx
  owner_open_id: ou_xxxxxxxx   # only respond to this user

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
```

You can override per-project with `.larkcc.yml` in your project root.

Priority: `.larkcc.yml` > env vars > `~/.larkcc/config.yml`

### Environment variables

```bash
export LARKCC_APP_ID=cli_xxxxxxxx
export LARKCC_APP_SECRET=xxxxxxxxxxxxxxxx
export LARKCC_OWNER_OPEN_ID=ou_xxxxxxxx
```

## Feishu Setup

1. Go to [Feishu Open Platform](https://open.feishu.cn)
2. Create an app → enable **Bot**
3. Permissions: `im:message` + `im:message:send_as_bot`
4. Event subscriptions → enable **Use WebSocket** → subscribe to `im.message.receive_v1`
5. Get your Open ID: send any message to the bot, check logs for your open_id

## Message Flow

1. User sends text message to bot in Feishu
2. larkcc receives via WebSocket, validates sender is owner
3. Message dispatched to Claude Agent SDK with current working directory
4. Claude's text responses stream back with live updates (throttled at 300ms)
5. Tool calls (Read, Write, Bash, etc.) shown as separate cards with status
6. Final response rendered as interactive card with Markdown support

## Dependencies

- `@anthropic-ai/claude-agent-sdk`: Claude Code Agent SDK
- `@larksuiteoapi/node-sdk`: Feishu/Lark official SDK
- Requires Claude CLI installed globally (`npm install -g @anthropic-ai/claude-code`)

## Development

```bash
pnpm dev    # Development with hot reload
pnpm build  # Compile TypeScript to dist/
pnpm start  # Run compiled code
```
