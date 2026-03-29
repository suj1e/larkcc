# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.1] - 2026-03-29

### Fixed

- Remove invalid MCP service link (404) from README

## [0.7.0] - 2026-03-29

### Added

- MCP document creation: use Feishu MCP service (`mcp.feishu.cn`) as primary path for creating cloud documents, with block API as fallback for non-table content
- Waiting card UX: shows "writing to document..." placeholder before document creation, updates to doc link after completion (both CardKit and non-streaming paths)
- Dynamic help text: `/help` now generates command list from `BUILTIN_EXEC` and `DEFAULT_PROMPTS` instead of hardcoded strings
- Architecture references in CONTRIBUTING.md (openclaw-lark, larksuite/cli, Feishu Block API)

### Changed

- Document header: use list format with bold labels, divider between quote and metadata, local timezone instead of UTC
- Session ID: show "首次对话" for first conversation instead of empty value
- Rewrite README: 1000+ lines → 221 lines, Chinese-only, concise structure
- Refactor block types: replace Descendants pattern with CreateData pattern (`CalloutCreateData`, `TableCreateData`)

### Fixed

- Add MCP HTTP status code validation and typed response parsing
- Fix `card_title` appearing twice in config example

### Removed

- Delete unused table creation functions (`createTableViaChildren`, `createTableChunk`, `getTableCellIds`, `concurrentExec` helper)
- Remove `upmd` slash command (too generic to be useful)
- Remove English documentation from README (Chinese-only now)

## [0.6.2] - 2026-03-28

### Fixed

- FlushController now sends a heartbeat flush every 15s during idle periods to prevent CardKit streaming timeout (200850)

## [0.6.1] - 2026-03-27

### Changed

- Thinking phase now shows "💭 思考中..." status in CardKit streaming, providing real-time feedback during reasoning

## [0.6.0] - 2026-03-27

### Added

- CardKit SDK migration: all API calls now use `client.cardkit.v1.*` instead of raw fetch with manual token management
- Streaming preview (summary) with correct object format `{ content, i18n_content }` for card list display
- Two-step streaming close: `card.settings({ streaming_mode: false })` then `card.update()`, aligned with openclaw-lark best practice
- `wide_screen_mode` and `update_multi` card config for all modes (CardKit, Update, non-streaming)
- Structured error handling: `CardKitApiError` class with `isRateLimit` and `isTableLimit` detection
- Shared `prepareOverflowContext()` helper extracted from `replyWithDocument()` for reuse in CardKit overflow
- Tool status display in CardKit mode: status text prepended to streaming content during tool calls

### Fixed

- Thinking block not captured (SDK sends `type: "thinking"` blocks, code only handled text/tool_use)
- Abort not updating card (abort handler inside event loop, never reached when SDK exits)
- Tool status not displaying when no text content yet (`updateStatus` didn't trigger card creation or flush)
- Bottom model name not showing in card footer (extracted from `modelUsage` keys instead of non-existent `result.model`)
- CardKit status bar visibility (empty initial content prevented element rendering)
- Sequence number conflicts between concurrent `updateStatus` and `performFlush` calls
- `updateStatus` not awaited in agent.ts causing potential state race conditions
- Unnecessary token cache invalidation on every overflow (now only refreshes when <10min remaining)

### Changed

- FlushController deduplication: CardKit mode now imports from `streaming.ts` instead of inline copy
- CardKit constructor no longer accepts `appId`/`appSecret` params (SDK handles token management)
- `@larksuiteoapi/node-sdk` upgraded from `^1` to `^1.60`
- Default `flush_interval_ms` changed from 300 to 200
- `/stop` now provides full abort feedback: signal received notification + success/failure message + distinct reaction

### Refactored

- Removed separate `status_bar` element, merged tool status into `streaming_content` as in-memory prefix to eliminate timing issues

## [0.5.0] - 2026-03-27

### Added

- Streaming output support with two modes: CardKit (default) and Update
  - **CardKit mode**: single-card architecture with state machine (idle → creating → streaming → completed), aligned with official openclaw-lark approach
  - **Update mode**: message patch API with auto-fallback chain (cardkit → update → none)
- Image resolver for external images (download and re-upload to Feishu CDN)
  - Internal CDN domain skip list (feishucdn.com, larksuitecdn.com, etc.)
- Configurable `card_title` for all streaming modes (default: "Claude")
- Collapsible thinking section in CardKit complete output
- Per-tool status words for tool cards (replaces random thinking words)
- `prepublishOnly` script to package.json for safe npm publishing
- Card footer metadata (model, tokens, duration) in streaming cards

### Changed

- Default streaming mode changed from `update` to `cardkit`
- CardKit mode no longer sends separate tool call cards (single-card design)

### Removed

- `thinking_words` config option (replaced by per-tool status words)

### Fixed

- Correct CardKit API format (card_json type, IM message reply, sequence counter)
- CardKit lazy card creation on first `append()` call
- Image resolver CDN download failures with internal domain blacklist
- ESM-compatible `__dirname` polyfill in guide.ts
- Align all docx block structures with Feishu SDK types to resolve 1770024 error

## [0.3.0] - 2026-03-26

### Added

- `/sync` command for one-command add-commit-push workflow
  - `/sync` auto-generates commit message from diff
  - `/sync <msg>` uses provided message

### Changed

- Simplify install.sh usage hints (add `--setup`, reduce to 8 lines)

### Fixed

- Unify reaction default value from "OK" to "Typing" in app.ts
- Simplify sendToolCard status logic with object lookup
- Remove duplicate emojis in DEFAULT_THINKING_WORDS

## [0.2.0] - 2026-03-26

### Added

- Configurable reaction emoji types (`reaction.processing`, `reaction.done`, `reaction.error`)
- Random thinking words for tool card status (40 default phrases like "💭 思考中...", "🔍 分析中...")
- Configurable `thinking_words` list in config.yml

### Changed

- Default processing emoji changed from `OK` to `Typing` (keyboard typing animation)
- Remove `--restart` command (unreliable, manual `--kill` + start is simpler)
- Simplify README command section to common examples + `--help` pointer

## [0.1.10] - 2026-03-26

### Fixed

- Fix Commander.js flag conflict: rename `--all` to `--cleanup-all` for `--cleanup-tmp-files` command
- Update install.sh hints to reflect current features (multi-bot, process management)

## [0.1.9] - 2026-03-25

### Changed

- Refactor: remove duplicate `parseInlineText` and `markdownToBlocks` from `feishu.ts`, use `format/` module instead

### Fixed

- Document meta info now displays each line separately for proper line breaks

## [0.1.8] - 2026-03-25

### Added

- New slash commands: `/quality`, `/release`, `/check`, `/security`, `/deps`
- Custom EXEC commands support (`exec_commands` in config.yml)
- EXEC security control with blacklist and confirmation (`exec_security` in config.yml)
- Template syntax for EXEC commands: `{{param}}` and `{{param|default}}`
- External image URL handling: convert `![](https://...)` to links with 🖼️ emoji
- New `src/format/` module for style and format handling
- Table support in Markdown to Feishu document conversion
- Task list (`- [ ]` / `- [x]`) support in document conversion
- Math equation (`$...$` / `$$...$$`) support in document conversion
- Callout block (`> [!NOTE]` etc.) support in document conversion
- Extended heading levels (H4-H6) in document conversion
- LanguageMap now based on official Feishu CodeLanguage enum (75 languages)
- Reference link: https://feishu.apifox.cn/doc-1950637

### Changed

- Refactor: extract style-related code to `src/format/` module
  - `constants.ts`: BlockType, LanguageMap, CalloutColors
  - `sanitize.ts`: Content sanitization (blob URL + external image)
  - `card.ts`: Card building utilities
  - `document.ts`: Markdown to document conversion
  - `parser.ts`: Markdown parsers (table, todo, equation, callout)
  - `builder.ts`: Block builders
- `sanitizeContent` now returns `{ content, warnings }` instead of `{ content, filteredCount }`
- External images are converted to links with 🖼️ emoji instead of being removed
- Refactor slash commands: PROMPT commands now loaded from `default-prompts.yml`
- User can now override built-in PROMPT commands via `commands` in config.yml
- Add confirmation mechanism for dangerous EXEC commands
- `src/format/sanitize.ts`: Use `console.warn` instead of `console.error`
- `src/format/document.ts`: Remove redundant `>` prefix in quote block parsing
- `src/format/card.ts`: Fix type safety (`client: any` → `client: Client`, `path` → `params`)
- `src/format/builder.ts`: Add TODO comment for table alignment limitation
- `src/format/index.ts`: Export `isQuote` function

### Fixed

- `release.sh`: Remove hardcoded CHANGELOG template insertion (now handled by `/release`)

## [0.1.7] - 2025-03-24

### Fixed

- Re-publish v0.1.6 with correct Node.js wrapper (previous npm publish had stale shell wrapper)

## [0.1.6] - 2025-03-24

### Fixed

- bin wrapper path resolution issue on macOS/nvm (switch to Node.js wrapper with `import.meta.url`)

## [0.1.5] - 2025-03-24

### Fixed

- npm global install executable permission issue (added `bin/larkcc` wrapper script)
- Version number now syncs with `package.json` automatically via build script

### Changed

- Update bin entry to use wrapper script instead of direct JS file
- Add `prebuild` script to auto-generate `src/version.ts`
- Remove incorrect troubleshooting section from README

## [0.1.4] - 2025-03-24

### Added

- Add `--kill <profile|pid>` command to terminate a specific process
- Add `--kill-all` command to terminate all running processes
- User confirmation before killing processes
- Graceful termination with SIGTERM, force kill with SIGKILL if needed

### Changed

- Add Feishu notification for release status (success/failure)

## [0.1.3] - 2025-03-24

### Fixed

- Filter blob URLs from content before sending to Feishu
- Fix card creation failures caused by websearch returning blob URLs

## [0.1.2] - 2025-03-24

### Changed

- Update README installation instructions for npm publishing
- Add release.sh script for automated version releases

## [0.1.1] - 2025-03-24

### Changed

- Add GitHub Actions CI/CD for automated npm releases

## [0.1.0] - 2025-03-24

### Added

- Initial release
- Feishu/Lark bot integration with Claude Code
- WebSocket real-time message handling
- Slash commands support (`/review`, `/fix`, `/commit`, `/pr`, etc.)
- Multi-profile support for multiple bots
- Session persistence with `--continue` flag
- Image and file handling
- Multi-file mode for batch file analysis
- Cloud document overflow for long messages
- Group chat support via @ mentions
- Auto-detection of owner's `open_id`
- Process locking to prevent conflicts
- Task control with `/stop` command
