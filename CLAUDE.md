# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

larkcc bridges Claude Code with Feishu (Lark) messaging. Users can chat with Claude via a Lark bot, and Claude operates in the project directory where larkcc is started.

## Commands

```bash
pnpm dev          # Development with hot reload
pnpm build        # Compile TypeScript to dist/
pnpm start        # Run compiled code
./install.sh      # Full install (checks deps, builds, global install)
```

## Architecture

```
src/
├── index.ts    # CLI entry (commander), handles --setup, --reset-session, -d daemon
├── app.ts      # WebSocket listener for Feishu messages, serial dispatch to agent
├── agent.ts    # Claude Code SDK event loop, throttled message updates to Feishu
├── feishu.ts   # Lark API: send/update text & interactive cards
├── config.ts   # Config loading: global < env < project (.larkcc.yml)
├── session.ts  # Claude session ID persistence for conversation continuity
├── setup.ts    # Interactive first-run config wizard
└── logger.ts   # Console logging with chalk
```

### Key Flow

1. `index.ts` parses CLI, loads config, calls `startApp()`
2. `app.ts` creates Lark WS client, listens for `im.message.receive_v1`
3. Only responds to `owner_open_id` (single-user design)
4. Messages dispatched to `agent.ts` which calls `@anthropic-ai/claude-agent-sdk` query()
5. Agent events processed:
   - `assistant` event: contains text blocks and tool_use blocks in content
   - `user` event: contains tool_result blocks in content
   - `result` event: final completion with session_id
6. Events are pushed back to Feishu as interactive cards

### Config Priority

`.larkcc.yml` (project) > `LARKCC_*` env vars > `~/.larkcc/config.yml` (global)

## Dependencies

- `@anthropic-ai/claude-code-agent`: Claude Code Agent SDK (imports as `@anthropic-ai/claude-agent-sdk`)
- `@larksuiteoapi/node-sdk`: Feishu/Lark official SDK
- Requires Claude CLI installed globally (`npm install -g @anthropic-ai/claude-code`)
