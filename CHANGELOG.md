# 9Router Monitor Pro Changelog

All notable changes to this project are documented in this file.

## [0.1.0] - 2026-09-17

### Added
- Official rebrand to **9Router Monitor Pro** (Author: **Minhtalent-dev**).
- **Multi-Account Aggregation**: Automatically computes total quota across all pinned accounts on status bar.
- **Multi-Pin Support**: Pin multiple accounts and multiple AI models simultaneously.
- **Toggle Provider Active Status**: Directly enable or disable provider accounts via 9Router API.
- **Webview Dashboard Pro Max**: Compact grid layout, realtime search, dynamic provider filter chips, multi-criteria sorting, and model visibility toggling.
- **Persistent Quick Menu**: Click status bar to open interactive menu with multi-select pinning and quick actions.
- **Multi-Machine Connectivity**: Connect remotely via Cloudflare Tunnel with automatic Dashboard Password authentication.
- **Zero-Config Local Discovery**: Automatically discovers local CLI credentials when running on the same machine.
- **Modern Model Quotas**: Dynamic quota parsing for Gemini 3.8 Flash, Claude Sonnet, Antigravity, and Codex.

### Fixed
- Fixed Unicode progress bar rendering glitch on Windows, replaced with crisp geometric shapes.
- Resolved HTTP 401 Unauthorized errors with modern 9Router server architecture.
- Seamless automatic token renewal on session expiration.

## [0.0.1] - 2026-06-10

### Added
- Initial release with basic token usage on status bar.
- Basic tooltip with progress indicators.
- Auto-refresh mechanism and API key storage via SecretStorage.
- `extraFields` cho phép hiển thị field tuỳ ý.
- `statusBarFormat` để chọn cách hiển thị trên status bar.
