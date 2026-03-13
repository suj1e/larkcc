# larkcc

Claude Code in Feishu — chat with Claude via your Lark bot, in any project directory.

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

## Commands

```bash
larkcc                  # start (foreground)
larkcc -d               # start in background
larkcc --setup          # reconfigure
larkcc --reset-session  # clear Claude session
larkcc --version
```
