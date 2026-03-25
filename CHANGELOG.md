# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
