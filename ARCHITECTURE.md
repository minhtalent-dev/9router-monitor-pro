# 9Router Monitor Pro — Cẩm Nang Kiến Trúc Clean Architecture

Tài liệu này là chuẩn mực kiến trúc dự án (Architecture Guidelines). Mọi tính năng, chỉnh sửa hoặc refactor trong tương lai **bắt buộc phải tuân theo 100%**, không được vi phạm nguyên tắc phân tách trách nhiệm và không được tạo lại các file nguyên khối (God-files).

---

## 1. Cây thư mục dự án (Project Directory Tree)

```
src/
├── extension.ts                  # Entrypoint: lifecycle activation, command registry, dual-timer scheduler
│
├── types/                        # Tầng Domain Contracts & Types
│   └── index.ts                  # ProviderConnection, QuotaData, UsageStats, ExtensionConfig, etc.
│
├── services/                     # Tầng Business Logic & Network (Đồ thị 1 chiều DAG)
│   ├── httpTransport.ts          # Core HTTP transport primitives: buildUrl, requestWithAuth (KHÔNG phụ thuộc ngược)
│   ├── quotaService.ts           # Fetching providers/accounts quota, normalization, concurrency pool (mapConcurrent)
│   ├── analyticsService.ts       # Fetching usage metrics (fetchUsageStats) & transactions (fetchRequestLogs)
│   ├── logStreamEngine.ts        # SSE live stream, Cloudflare Tunnel Adaptive Polling & Watchdog timer
│   ├── authManager.ts            # CLI Secret hash scanning (mtime-sorted), loginDashboard, secrets storage
│   ├── stateManager.ts           # In-memory reactive state cache, activeConfig, pinning preferences
│   └── apiClient.ts              # Facade Barrel Re-export (Re-export toàn bộ services con, 0 breaking changes)
│
├── ui/                           # Tầng Presentation & Controllers
│   ├── statusBar.ts              # Primary Quota status bar + Secondary $(terminal) 9R Log widget
│   ├── tooltip.ts                # Hover Intelligence Markdown tooltips (Quota table + 9R Log snapshot)
│   ├── quickMenu.ts              # Interactive QuickPick dialogs (Connection, Intervals, Display style)
│   └── dashboardPanel.ts         # Webview Panel lifecycle manager & bi-directional message bus controller
│
├── views/                        # Tầng Modular Webview Presentation
│   ├── dashboardTemplate.ts      # Orchestrator (< 100 dòng): Ráp nối tài liệu HTML hoàn chỉnh
│   ├── styles/
│   │   └── dashboardStyles.ts    # 100% CSS stylesheet (Fluent Dark theme, KPI cards, terminal, responsive)
│   ├── scripts/
│   │   └── dashboardScript.ts    # 100% Webview Client JS (DOM listeners, tab switch, midnight timer, pagination)
│   └── tabs/
│       ├── providersTab.ts       # Tab 1 Component: Providers & Quotas grid, account cards, model chips
│       ├── analyticsTab.ts       # Tab 2 Component: KPI cards, Recent Requests table, filters, pagination
│       └── consoleLogTab.ts      # Tab 3 Component: Terminal console, controls toolbar, filters, pagination
│
└── utils/                        # Tầng Shared Pure Utilities
    ├── formatters.ts             # formatCompact, formatResetCompact, getHealthIcon, renderTextBar
    ├── helpers.ts                # escHtml, displayName, formatDate, getUsedPercent, quotaTitle
    └── logger.ts                 # Diagnostic OutputChannel & debug logging
```

---

## 2. Các nguyên tắc bắt buộc (Mandatory Architecture Rules)

### 2.1. Giới hạn số dòng code trên mỗi file (Lines of Code Limits)
- **File logic TypeScript & Service**: Nghiêm cấm vượt quá **450 dòng**. Khi đạt mốc 400 dòng, bắt buộc phải tách module con.
- **File Orchestrator HTML (`dashboardTemplate.ts`)**: Luôn giữ dưới **150 dòng** (chỉ làm nhiệm vụ ráp nối các components).
- **File Assets tĩnh/Client (`dashboardStyles.ts`, `dashboardScript.ts`)**: Giới hạn tối đa **950 dòng**.

### 2.2. Đồ thị phụ thuộc 1 chiều trong Services (Directed Acyclic Graph - DAG)
- `httpTransport.ts` là module tầng thấp nhất của Services, tuyệt đối **không được import** từ bất kỳ service con nào.
- Các service con (`quotaService`, `analyticsService`, `logStreamEngine`) chỉ import từ `httpTransport.ts`.
- `apiClient.ts` đóng vai trò là **Barrel Facade** re-export toàn bộ các service con.
- Nghiêm cấm tạo liên kết phụ thuộc vòng tròn (**Circular Dependency**).

### 2.3. Quy tắc phát triển giao diện Webview
- **Không nhúng trực tiếp inline CSS hoặc JavaScript** vào các file HTML component hoặc template.
- Toàn bộ CSS phải được bổ sung vào `src/views/styles/dashboardStyles.ts`.
- Toàn bộ logic Client JS phải được viết trong `src/views/scripts/dashboardScript.ts`.
- Mỗi Tab giao diện phải là một component cô lập đặt tại `src/views/tabs/`.
- `<style>` luôn nhúng trong `<head>`, `<script>` luôn nhúng ở đáy thẻ `<body>`.

### 2.4. Kiến trúc Dual-Timer Auto-Refresh
- **Timer 1 (Quotas)**: `aiTokenUsage.refreshIntervalSeconds` (tối thiểu 5s, mặc định 60s) làm mới toàn bộ 47 tài khoản quota.
- **Timer 2 (9R Log Status Bar)**: `aiTokenUsage.logStatusBarRefreshIntervalSeconds` (tối thiểu 3s, mặc định 10s) chạy ngầm siêu nhẹ trong 200ms, làm mới tức thì tooltip và chỉ số của `$(terminal) 9R Log`.
- Hai timer chạy độc lập, không được để việc fetch quota nặng làm nghẽn hiển thị log status bar.

### 2.5. Hợp đồng bảo toàn (Zero Regression Contract)
- Bất kỳ refactoring hay mở rộng tính năng mới nào cũng phải bảo đảm không phá vỡ hợp đồng export hiện tại trong `apiClient.ts` để các consumer bên ngoài (`dashboardPanel.ts`, `extension.ts`) luôn hoạt động bình thường.
