# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
