# 9Router Monitor Pro

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/minhtalent-dev/9router-monitor-pro/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-VS%20Code%20%7C%20Antigravity-orange.svg)](https://github.com/minhtalent-dev/9router-monitor-pro)

VS Code extension to track quota, token usage, and account health across 9Router AI providers directly in the **status bar**.

Supports multi-account management, multi-model tracking, automatic quota aggregation, custom pinning, and remote connections via Cloudflare Tunnel.

**Author**: [Minhtalent-dev](https://github.com/minhtalent-dev) · **Repository**: [github.com/minhtalent-dev/9router-monitor-pro](https://github.com/minhtalent-dev/9router-monitor-pro)

---

## 📸 Screenshots & Showcase

### 1. Interactive Webview Dashboard Pro Max
Real-time AI provider matrix with model search, category filter chips (`Antigravity`, `Gemini`, `Claude`, etc.), multi-criteria sorting, and one-click pin/hide/toggle controls:

![9Router Monitor Pro Webview Dashboard](media/screenshot-dashboard.png)

### 2. Status Bar Quota Aggregation & Detailed Tooltip
Status bar displays condensed real-time totals across multiple accounts (`10 ⭐ · G3.8 9.9K · GW 8.6K`). Hovering reveals a high-density Markdown summary with per-account breakdown and reset countdowns:

![Status Bar Aggregation & Details Tooltip](media/screenshot-status.png)

---

## Key Features

- **Multi-Account Aggregation**: Automatically sums up quota and usage across all pinned accounts into a clean, compact status bar metric.
- **Multi-Pin (Models & Accounts)**: Pin multiple accounts and multiple AI models simultaneously.
- **Toggle Provider Active Status**: Enable or disable provider accounts on the fly via 9Router API.
- **Webview Dashboard Pro Max**: Fluent Dark Theme grid layout with realtime search, provider/category filter chips, multi-criteria sorting, and hide/unhide options.
- **Interactive Quick Menu**: Click status bar to open a persistent command palette menu for instant pinning, toggling, and refreshing without hover dismissal.
- **Flexible Connectivity (Local Zero-Config & Remote Tunnel)**:
  - Automatically detects local CLI token from AppData when running on the same machine.
  - Supports connecting across machines using Cloudflare Tunnel and Dashboard Password with automatic session refresh.
- **Configurable Display Styles**: Choose between `Compact` (default, balanced), `Detailed` (full ratio + reset times), or `Minimal` (ultra-compact numbers only).
- **Secure Credential Storage**: Passwords and session tokens are encrypted via VS Code `SecretStorage`.

---

## Installation for Antigravity & Alternative IDEs

9Router Monitor Pro works seamlessly on **Antigravity**, **Cursor**, **Windsurf**, and **VS Code**.

### Method 1: Install via CLI
```powershell
# For Antigravity
antigravity --install-extension 9router-monitor-pro-1.0.0.vsix --force

# For VS Code
code --install-extension 9router-monitor-pro-1.0.0.vsix --force
```

### Method 2: Install from VSIX in IDE UI
1. Download `9router-monitor-pro-1.0.0.vsix` from [Releases](https://github.com/minhtalent-dev/9router-monitor-pro/releases).
2. Open Antigravity or VS Code -> Extensions view (`Ctrl+Shift+X`).
3. Click `...` (Views and More Actions) at top right -> **Install from VSIX...** -> Select the `.vsix` file.

---

## Installation & Development

```powershell
npm install
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host.

---

## Getting Started

### Mode 1: Local Machine (Zero-Config)
If 9Router is running on the same machine, the extension automatically discovers the local CLI credentials from AppData. All active providers and quotas display immediately.

### Mode 2: Remote Access via Cloudflare Tunnel
1. Open Command Palette (`Ctrl+Shift+P`).
2. Run: **`9Router Monitor Pro: Set Connection (URL & Password)`**.
3. Enter **Base URL**:
   - Remote: Enter Cloudflare Tunnel URL from 9Router (e.g., `https://rv6v39u.abc-tunnel.us`).
   - Local: Keep default `http://localhost:20128`.
4. Enter **Dashboard Password**:
   - 9Router Web Dashboard password (default: `123456`).
   - The extension authenticates, caches the session token, and automatically re-authenticates upon token expiration.

---

## Commands

| Command | Description |
| --- | --- |
| `9Router Monitor Pro: Open Interactive Menu` | Open quick actions (pin accounts, pin models, toggle active) |
| `9Router Monitor Pro: Set Connection (URL & Password)` | Configure Base URL (Tunnel/Local) and Dashboard Password |
| `9Router Monitor Pro: Set API Key` | Manually configure API key (optional) |
| `9Router Monitor Pro: Refresh` | Trigger immediate usage data refresh |
| `9Router Monitor Pro: Show Dashboard` | Open interactive Webview matrix with search, filters, and cards |
| `9Router Monitor Pro: Set Refresh Interval` | Configure auto-refresh frequency (15s, 30s, 60s, custom) |
| `9Router Monitor Pro: Set Status Bar Display Style` | Switch between Compact, Detailed, and Minimal status bar formats |

---

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `aiTokenUsage.statusDisplayMode` | `compact` | Status bar display style (`compact`, `detailed`, `minimal`) |
| `aiTokenUsage.apiBaseUrl` | `http://localhost:20128` | 9Router Base URL (Local or Cloudflare Tunnel) |
| `aiTokenUsage.authMode` | `auto` | Authentication mode (`auto`, `password`, `token`) |
| `aiTokenUsage.providersPath` | `/api/providers?page=1&pageSize=20&accountStatus=all&sort=priority&isActive=true` | Endpoint to fetch providers list |
| `aiTokenUsage.usagePathTemplate` | `/api/usage/{id}` | Endpoint template to fetch usage by provider ID |
| `aiTokenUsage.statusBarQuota` | `session` | Fallback quota for status bar when no model is pinned |
| `aiTokenUsage.refreshIntervalSeconds` | `60` | Auto-refresh interval in seconds (minimum: 10) |

---

## Packaging `.vsix`

```powershell
npx @vscode/vsce package --no-dependencies
```

Install directly into VS Code or Antigravity:
```powershell
code --install-extension 9router-monitor-pro-1.0.0.vsix --force
```

---

## License

MIT License © 2026 Minhtalent-dev

```
