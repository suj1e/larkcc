# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.12.6] - 2026-05-09

### Fixed

- Fix `Claude Code native binary not found` error on Windows: cross-platform claude binary detection (`where` on Windows, `which` on POSIX)
- Add `claude.path` config field for manual override of Claude Code binary location
- Fix `ensureEnv()` and `ensureClaudeInPath()` for Windows: skip bash PATH injection, use Windows common paths (`APPDATA/npm`), correct PATH separator (`;` vs `:`)

## [0.12.5] - 2026-05-09

### Changed

- Sub-agent card: swap header title/subtitle (description as title, "Sub Agent" as subtitle), add header tags (elapsed time + tokens)
- Sub-agent card: display tool call sequence with arrow display; terminal state merges consecutive duplicates with counts
- Replace sub-agent footer column_set with header text_tag_list, removing duplicate info between header and footer
- Accumulate tool call history from progress events in TaskPanelController
- Logger timestamp color: `chalk.gray` → `chalk.blue`

### Fixed

- Tool result truncation: remove 500-char early truncation in agent.ts (both CardKit and non-CardKit paths), let `buildToolResultPanel` handle it uniformly at 2000 chars
- Extract `STREAMING_TRUNCATE` (4000) and `TASK_SUMMARY_TRUNCATE` (3000) as shared constants, eliminating duplicated `TRUNCATE_LIMIT` in cardkit.ts and streaming.ts
- Remove unused `truncate()` helper and `THINKING_OVERFLOW_TRUNCATE` import in cardkit.ts

## [0.12.4] - 2026-05-09

### Changed

- Footer stats layout: single-line grey text → column_set with equal-width columns (input/output tokens, tool count)
- Tool panel header: plain text → markdown formatting (bold label + inline code detail)
- Task panel footer: single-line grey text → column_set
- Extract `buildStatsTags()` to eliminate duplicated tag construction in cardkit.ts and message.ts

## [0.12.3] - 2026-05-09

### Fixed

- Suppress SDK warning for unhandled `im.message.reaction.created_v1` / `deleted_v1` events

## [0.12.2] - 2026-05-09

### Added

- Format tool result content by type: Read results use language-tagged code blocks (auto-detected from file extension), Bash results use bash code blocks
- Increase tool result truncation threshold from 500 to 2000 characters

## [0.12.1] - 2026-05-09

### Added

- Tool result collapsible panels in CardKit mode: each tool call is shown as a collapsed panel with result preview in the final card
- Format tool result content by type: Read results use language-tagged code blocks (auto-detected from file extension), Bash results use bash code blocks
- Increase tool result truncation threshold from 500 to 2000 characters

### Fixed

- Fix `collapsible_panel` field: `background_style` → `background_color` (align with official Feishu card JSON v2 spec)

## [0.12.0] - 2026-05-09

### Changed

- **Build system: migrate from `tsc` to `tsup`** — output a single self-contained `dist/index.js` (all dependencies bundled)
- Convert `default-prompts.yml` → `default-prompts.ts` (typed object export, no runtime file reading)
- Convert `format-guide.md` → `default-guide.ts` (string export, eliminates `__dirname` resource resolution)
- Simplify `tsconfig.json` to typecheck-only (`noEmit`), build responsibility fully on tsup
- Move all `dependencies` to `devDependencies` (bundled by tsup at build time)
- Update CI: add `typecheck` step, remove `chmod +x bin/larkcc` from release workflow

### Removed

- `bin/larkcc` entry wrapper (tsup output has shebang, `bin` points directly at `dist/index.js`)
- `install.sh` and `release.sh` (use `npm i -g larkcc` / `npm version` + CI auto-publish)
- `resources/format-guide.md` and `src/commands/default-prompts.yml` (inlined into source)

## [0.11.1] - 2026-04-29

### Fixed

- Rewrite Feishu Notify workflow with Node.js to fix shell injection vulnerability in `${{ }}` interpolation of user content
- Add proxy support (`undici.ProxyAgent`) to all fetch calls for cloud document creation, token refresh, and image upload
- Remove conflicting `version: 9` param from pnpm/action-setup across workflows, use `packageManager` field from package.json instead

### Changed

- Unify Node.js v22 and pnpm/action-setup@v4 across all workflows (ci, deps-check, notify, release)
- Streamline GitHub templates: numeric prefix for display order, dedup notice on bug report, remove Priority/Alternatives from feature request, simplify PR template to minimal hint

## [0.11.0] - 2026-04-24

### Added

- HTTPS proxy support for WebSocket client (`https_proxy` / `HTTPS_PROXY` env vars)
- Auto-detect Claude CLI path for agent SDK

### Changed

- Update `@anthropic-ai/claude-agent-sdk` 0.2.92 → 0.2.114
- Update `@larksuiteoapi/node-sdk` 1.60.0 → 1.61.1

## [0.10.2] - 2026-04-18

### Changed

- Redesign sub-agent task panel card: fixed header title to `🤖 Sub Agent` with description as subtitle, removed `text_tag_list` (no duplicate elapsed time), removed body `hr` dividers for compact layout
- Footer now shows on all states: running displays `⏱ elapsed`, terminal states add `🪙 tokens`
- Removed `cardTitle` parameter chain from `TaskPanelCardOptions`, `sendTaskCard`, `TaskPanelController`, and agent instantiation

## [0.10.1] - 2026-04-18

### Fixed

- Windows ESM import error (`ERR_UNSUPPORTED_ESM_URL_SCHEME`): use `pathToFileURL` to convert paths to `file://` URLs (#2)

## [0.10.0] - 2026-04-18

### Added

- Sub-agent task panel cards: header icon, subtitle, text_tag_list (elapsed time + tokens), terminal-state footer
- Fallback overflow document cards: header with stats tags + footer (previously plain markdown)
- `/updeps` slash command: interactive 3-phase dependency upgrade tool (overview → plan → execute)
- `/issues` slash command: report manually created GitHub Issues (excludes auto deps-update)
- `.github/workflows/notify.yml`: Feishu notifications for new Issues, PRs, comments + daily digest
- `headerIconImgKey` passthrough from config to CardKit, TaskPanel, and CompleteOptions

### Changed

- CardKit overflow cards now use header tags + footer instead of appending raw metadata text
- Sub-agent card body simplified: status line only shows icon + label + last tool (elapsed/tokens moved to header)

### Fixed

- CardKit `handleOverflow` now passes `stats` to `buildFinalCard` (was missing header tags and footer)
- Removed duplicate metadata display in overflow document cards

## [0.9.0] - 2026-04-18

### Added

- CardKit streaming card visual enhancement: dynamic header with state-aware colors (indigo=thinking, green=completed, grey=aborted)
- Header icon support: `standard_icon` (default `larkcommunity_colorful`) with configurable `header_icon_img_key` for custom icon
- Header `text_tag_list` pills showing model name, total tokens (input+output), and duration
- Header subtitle showing current state text ("正在思考..." / "对话完成" / "已停止")
- Footer stats bar with lightweight grey text showing input/output tokens and tool call count
- `buildHeader()` and `buildFooterMarkdown()` builder functions for card header/footer construction
- `width_mode: "fill"` for full-width CardKit cards
- Dynamic summary text via `closeStreamingMode()` (e.g. "🤔 Claude 正在思考..." → "✅ Claude · 对话完成")
- Tool status display as `<text_tag>` in streaming content
- Thinking panel with `background_style: "wathet"`
- Tool collapsible panel with `background_style: "grey"`
- Separate `buildAbortCard()` for clean abort-state rendering

### Changed

- CardKit mode no longer appends metadata (`⏱ · model · tokens`) to card body — stats moved to header tags + footer
- Card creation starts with empty content instead of "⏳ 思考中..."
- Token display changed from output-only to total (input + output) in header

## [0.8.0] - 2026-04-12

### Added

- Multi-agent task panel: real-time Feishu cards for sub-agents spawned by Claude, showing status (running/completed/failed/stopped), progress summary, tool name, elapsed time, and token usage
- `TaskPanelController` class for managing per-agent card lifecycle (`task_started`, `task_progress`, `task_notification` events)
- Main card status bar integration: shows live summary like `🤖 2 agents: Fix auth (Bash), Update tests (Glob)`
- `MultiAgentConfig` with `enabled` and `max_concurrent_agents` settings in `config.yml`
- System prompt guidance (Section 5) instructing Claude when and how to use multi-agent parallel tasks
- `abortAll()` / `completeAll()` for graceful cleanup on user abort or main agent finish

### Changed

- Default processing timeout increased from 30 minutes to 1 hour (multi-agent tasks take longer)

### Fixed

- Fix `abortController` typing after dependency upgrade

## [0.7.4] - 2026-04-02

### Fixed

- Fix document cleanup API type parameter: `type=file` → `type=docx` (documents were not being deleted)
- Fix cleanup registry drift: only remove record on confirmed deletion or confirmed non-existence (error codes 1061003/1061007), keep record on transient failures for retry

### Changed

- Simplify `CleanupConfig`: remove `enabled` and `notify` fields, cleanup always runs with single `max_docs` threshold
- Remove cleanup notification from user-facing messages (now log-only)
- Replace passive timeout check (10min, triggered by next message) with active timer that properly aborts the agent
- Add configurable `processing_timeout_ms` (default: 30 minutes, top-level config field)
- Add timeout reaction (`Clock` emoji) to distinguish timeout from user-initiated abort and errors

## [0.7.3] - 2026-03-29

### Fixed

- Add document cleanup to CardKit overflow path (was only working in non-streaming mode)

## [0.7.2] - 2026-03-29

### Changed

- Simplify README: remove source install, trim config, use English headers
- Use English name for Feishu Block API in CONTRIBUTING

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
