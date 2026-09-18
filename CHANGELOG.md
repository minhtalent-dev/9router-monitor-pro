# 9Router Monitor Pro Changelog

All notable changes to this project are documented in this file.

## [1.1.0] - 2026-09-18

### Added
- 🖥️ **Live Console Log (SSE & Adaptive Tunnel)**: 
  - Tích hợp tab Console Log máy chủ trực tiếp vào Webview Dashboard qua kết nối SSE chuẩn RFC (`/api/translator/console-logs/stream`).
  - Giao diện terminal đen Fluent dark cao cấp với tô màu cú pháp theo mã trạng thái (`DONE`, `POST`, `TOKEN_REFRESH`, `WARN`, `ERROR`), huy hiệu trạng thái `Live (SSE)` hoặc `Live (Tunnel)`.
  - Bộ điều khiển mạnh mẽ: Pause/Resume stream, Clear đồng bộ máy chủ, Reconnect tức thời, Auto-scroll thông minh.
  - Hỗ trợ lọc theo từ khóa, chọn ngày linh hoạt (tự động rollover sang ngày mới lúc nửa đêm) và phân trang linh hoạt (100, 200, 500, All dòng; nút First/Prev/Next/Last).
- 📈 **Usage & Analytics**:
  - Tích hợp tab giám sát hiệu năng và chi phí với 5 thẻ KPI trọng yếu: Total Requests, Prompt Tokens, Cached Tokens, Completion Tokens và Est. Cost.
  - Bảng thống kê chi tiết lịch sử các yêu cầu gần nhất kèm thông tin Model, Provider, Tài khoản, Tỷ lệ In/Out Tokens và trạng thái xử lý.
  - Tích hợp bộ chọn ngày (Today/All/DatePicker), tự động làm mới theo chu kỳ (1s, 2.5s, 5s, 10s, 30s) hoặc làm mới thủ công.
- ⚡ **Dedicated Status Bar 9R Log Widget**:
  - Bổ sung widget trạng thái độc lập `$(terminal) 9R Log` đặt cạnh widget Quota chính, hiển thị trạng thái kết nối và nhịp đập trực tiếp (Live Pulse).
  - Cung cấp 3 chế độ hiển thị linh hoạt: `Minimal` (`$(terminal) 9R Log`), `Compact` (`$(terminal) 9R Log · 10.1K req · G3.8 🟢`), và `Detailed` (`$(terminal) 9R Log · 10.1K req · $980 · G3.8 7.2K/940 🟢`).
  - Tùy chỉnh bật/tắt widget độc lập qua setting `aiTokenUsage.showLogStatusBar`.
- 🔍 **Minimalist Hover Intelligence HUD**:
  - Tooltip Markdown mật độ cao khi hover vào 9R Log Status Bar: hiển thị tức thì bảng snapshot KPI và danh sách 10/25/50 giao dịch gần nhất.
  - Lựa chọn nhanh số lượng log hiển thị (`Show: 10  25  50`) ngay trên tooltip với độ trễ 0ms.
  - Thiết kế đồng bộ hoàn hảo giữa Quota Monitor tooltip và 9R Log tooltip với chân trang điều hướng thống nhất 6 action: `Quick Menu`, `Dashboard`, `Live Console Log`, `Usage Analytics`, `Mode: [Current]`, và `Refresh`.
- ⏱️ **Dual-Timer Auto-Refresh Architecture**:
  - Tách biệt hai chu kỳ làm mới độc lập: Quota Timer cho hạn mức tài khoản (mặc định 60s) và 9R Log Fast Timer cho telemetry/giao dịch (mặc định 10s, hỗ trợ từ 3s).
  - Tải ngầm siêu tốc ~200ms không gây gián đoạn hay block giao diện người dùng.
- 🏗️ **Modular Clean Architecture**:
  - Tái cấu trúc toàn bộ mã nguồn theo chuẩn Clean Architecture 5 tầng: Domain Models (`types/`), Transport Layer (`services/httpTransport.ts`), Specialized Services (`quotaService.ts`, `analyticsService.ts`, `logStreamEngine.ts`, `apiClient.ts`), UI Controllers (`statusBar.ts`, `tooltip.ts`, `quickMenu.ts`, `dashboardPanel.ts`), và Modular Views (`views/tabs/`, `views/styles/`, `views/scripts/`).
  - Loại bỏ hoàn toàn các God-files nguyên khối, đảm bảo cấu trúc DAG không circular dependencies.

### Fixed
- **Cloudflare Tunnel SSE Buffering Freeze**: Triển khai Adaptive Log Engine tự động nhận diện URL Remote / Cloudflare Tunnel để chuyển đổi sang cơ chế transaction polling thông minh với bộ đệm khử trùng lặp (Deduplication Set), vượt qua cơ chế proxy buffering của Cloudflare.
- **HTTP 401 Unauthorized do CLI Secret đa tài khoản**: Triển khai quét đa thư mục AppData cục bộ và tự động chọn CLI Token mới nhất theo thời gian sửa đổi file (`mtimeMs`).
- **Màn hình Terminal trống khi kết nối**: Loại bỏ fake init event và chuẩn hóa cơ chế phân tách chunk SSE theo ranh giới `\n\n` chuẩn RFC.
- **Lỗi Stale Cache Reset Display Styles**: Loại bỏ biến đệm trong bộ nhớ gây ghi đè cài đặt người dùng, đồng bộ trực tiếp với `vscode.workspace.getConfiguration` làm nguồn chân lý duy nhất (Single Source of Truth).
- **Rơi dòng menu footer tooltip**: Loại bỏ ký tự phân cách gạch đứng `|` rườm rà, tối ưu khoảng cách hiển thị nút bấm gọn gàng, thanh thoát trên 1 dòng đơn.

## [1.0.3] - 2026-09-17

### Added
- **Direct 1-Click Tooltip Mode Toggle**: Added `[Toggle: Summary Only / Show All Details]` command link directly inside the status bar tooltip footer for zero-latency, 1-click toggling.
- **In-Memory Config Cache & Zero-Latency Renders**: Synchronized config updates across all subsystems with instant 0ms status bar re-rendering, avoiding race conditions and redundant network calls on display style changes.

### Fixed
- **QuickPick Hover Focus Lost Bug**: Added delay buffer and `ignoreFocusOut: true` to prevent VS Code hover widget dismissal from inadvertently closing the QuickPick selection menu.

## [1.0.2] - 2026-09-17

### Added
- **Integrated Dashboard Settings Toolbar**: Added instant controls directly inside Webview Dashboard for Status Bar Style (Compact / Detailed / Minimal), Tooltip Detail Level (All / Summary Only / Accounts Only), and Auto-Refresh Interval (15s, 30s, 60s, 2m, 5m).
- **Two-Way Settings Sync**: Real-time message bus syncs settings chosen in Dashboard with VS Code configuration and Status Bar.

## [1.0.1] - 2026-09-17

### Added
- **New 3D Icon Branding**: Upgraded official extension icon to modern 3D glowing `9R PRO` badge.
- **Enhanced Webview Header**: Synchronized glowing 3D logo into Webview Dashboard header.
- **Cleaned Command Palette**: Removed deprecated `Set API Key` command for streamlined user experience.

### Fixed
- **Status Bar Alert Accuracy**: Eliminated false warning alerts (yellow badge) when unpinned quotas or zero-quota models exist. Health alerts now evaluate strictly against pinned models.
- **Accurate Quota Calculations**: Corrected remaining percentage calculations for inactive or zero-quota entries.

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
- **Configurable Status Bar Display Styles**: Switch between `Compact` (default, balanced), `Detailed` (full ratio + reset times), and `Minimal` (ultra-compact numbers only).
- **Progress Notifications & Standardized Toasts**: Integrated `vscode.window.withProgress` for manual refresh actions and unified `[9Router Pro]` status toasts.
- **Visual Showcase Gallery**: Added official screenshots covering Webview Dashboard, Status Bar Quota Aggregation, Quick Menu, and Command Palette.
- **100% English UI**: Standardized all UI, command titles, tooltips, settings, and documentation for international publishing.

### Fixed
- Fixed Unicode progress bar rendering glitch on Windows, replaced with crisp geometric shapes (`■` & `□`).
- Resolved HTTP 401 Unauthorized errors with modern 9Router server architecture.
- Seamless automatic token renewal on session expiration.
- Optimized packaging: excluded internal planning docs to reduce `.vsix` bundle size.

## [0.0.1] - 2026-06-10

### Added
- Initial prototype release with basic token usage display.
