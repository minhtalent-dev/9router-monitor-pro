# 9Router Monitor Pro Changelog

All notable changes to this project are documented in this file.

## [1.0.0] - 2026-09-17

### Added
- Official launch of **9Router Monitor Pro** (Author: **Minhtalent-dev**).
- **Multi-Account Aggregation**: Automatically computes and sums up quotas across all pinned accounts into a clean, compact status bar display.
- **Multi-Pin Support**: Pin multiple accounts and multiple AI models simultaneously.
- **Toggle Provider Active Status**: Directly enable or disable provider accounts via 9Router API (`PUT /api/providers/:id`).
- **Webview Dashboard Pro Max**: Compact grid layout, realtime search, dynamic provider filter chips, multi-criteria sorting, and model visibility toggling.
- **Persistent Quick Menu**: Click status bar to open interactive menu with multi-select pinning and quick actions.
- **Configurable Refresh Interval**: Quick menu action and command to set auto-refresh rate (15s, 30s, 60s, 2m, 5m, or custom).
- **Multi-Machine Connectivity**: Connect remotely via Cloudflare Tunnel with automatic Dashboard Password authentication.
- **Zero-Config Local Discovery**: Automatically discovers local CLI credentials when running on the same machine.
- **Modern Model Quotas**: Dynamic quota parsing for Gemini 3.8 Flash, Claude Sonnet, Antigravity, and Codex.
- **100% English UI**: Standardized all UI, command titles, tooltips, settings, and documentation for international publishing.

### Fixed
- Fixed Unicode progress bar rendering glitch on Windows, replaced with crisp geometric shapes (`■` & `□`).
- Resolved HTTP 401 Unauthorized errors with modern 9Router server architecture.
- Seamless automatic token renewal on session expiration.
- Optimized packaging: excluded internal planning docs to reduce `.vsix` bundle size.

## [0.0.1] - 2026-06-10

### Added
- Initial prototype release with basic token usage display.
