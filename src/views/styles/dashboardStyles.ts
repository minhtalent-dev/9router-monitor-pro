export function getDashboardStyles(): string {
  return `
  :root {
    --bg: #0d1117;
    --card-bg: #161b22;
    --card-border: #30363d;
    --card-primary-border: #1f6feb;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --text-dim: #6e7681;
    --green: #3fb950;
    --yellow: #d29922;
    --red: #f85149;
    --blue: #58a6ff;
    --track: #21262d;
    --btn-hover: #30363d;
    --radius: 8px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    padding: 20px;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--card-border);
    gap: 12px;
    flex-wrap: wrap;
  }
  .header-left h1 {
    font-size: 20px;
    font-weight: 600;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .header-left .updated {
    color: var(--text-muted);
    font-size: 12px;
    margin-top: 2px;
  }
  .header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn {
    border: 1px solid var(--card-border);
    background: var(--card-bg);
    color: var(--text);
    padding: 6px 14px;
    border-radius: var(--radius);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn:hover {
    background: var(--btn-hover);
    border-color: #8b949e;
  }
  .btn-primary {
    background: #238636;
    border-color: #2ea043;
    color: #ffffff;
  }
  .btn-primary:hover {
    background: #2ea043;
    border-color: #3fb950;
  }

  /* Toolbar */
  .toolbar {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius);
    padding: 12px 16px;
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .toolbar-row-top {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  .search-box {
    flex: 1;
    min-width: 240px;
  }
  .search-box input {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text);
    padding: 8px 12px;
    border-radius: var(--radius);
    font-size: 13px;
    outline: none;
    transition: border-color 0.2s ease;
  }
  .search-box input:focus {
    border-color: var(--blue);
  }
  .sort-box select {
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text);
    padding: 8px 12px;
    border-radius: var(--radius);
    font-size: 13px;
    outline: none;
    cursor: pointer;
  }
  .sort-box select:focus {
    border-color: var(--blue);
  }
  .toolbar-row-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .filter-chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .filter-chip {
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  }
  .filter-chip:hover {
    color: var(--text);
    border-color: var(--text-muted);
  }
  .filter-chip.active {
    background: #1f6feb;
    border-color: #388bfd;
    color: #ffffff;
    font-weight: 500;
  }
  .show-hidden-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
    user-select: none;
  }
  .show-hidden-toggle input {
    cursor: pointer;
  }

  .toolbar-row-settings {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--card-border);
  }
  .setting-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .setting-item label {
    font-weight: 500;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 4px;
    user-select: none;
  }
  .setting-item select {
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text);
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px;
    outline: none;
    cursor: pointer;
    transition: border-color 0.15s ease;
  }
  .setting-item select:focus {
    border-color: var(--blue);
  }

  /* Provider Section */
  .provider-section {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius);
    padding: 16px;
    margin-bottom: 16px;
    transition: border-color 0.15s ease;
  }
  .provider-section.primary { border-color: var(--card-primary-border); }
  .provider-section.pinned-account {
    border-color: #855b14;
    box-shadow: 0 0 10px rgba(227, 179, 65, 0.12);
  }
  .provider-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--card-border);
  }
  .provider-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 600;
  }
  .provider-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .pinned-account-btn, .pin-account-btn {
    border: 1px solid var(--card-border);
    background: var(--bg);
    color: var(--text-muted);
    border-radius: 14px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .pinned-account-btn:hover, .pin-account-btn:hover {
    background: var(--btn-hover);
    color: var(--text);
    border-color: #8b949e;
  }
  .pinned-account-btn.active, .pin-account-btn.active {
    background: #2b2310;
    border-color: #855b14;
    color: #e3b341;
  }
  .toggle-btn {
    border: 1px solid var(--card-border);
    border-radius: 14px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .toggle-btn.active {
    background: #0d2818;
    border-color: #1b4721;
    color: var(--green);
  }
  .toggle-btn.active:hover {
    background: #1b4721;
    border-color: #2ea043;
  }
  .toggle-btn.inactive {
    background: #2d1111;
    border-color: #5a1e1e;
    color: var(--red);
  }
  .toggle-btn.inactive:hover {
    background: #5a1e1e;
    border-color: #f85149;
  }
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .badge {
    display: inline-block;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 12px;
    background: #21262d;
    color: var(--text-muted);
    border: 1px solid var(--card-border);
  }
  .badge.priority { color: var(--blue); border-color: #1f4470; background: #0d1f3c; }
  .badge.plan { color: #d2a8ff; border-color: #3d2960; background: #1c1236; }
  .badge.provider { color: #58a6ff; border-color: #1f4470; background: #0d1f3c; }
  .badge.active { color: var(--green); border-color: #1b4721; background: #0d2818; }
  .badge.inactive { color: var(--red); border-color: #5a1e1e; background: #2d1111; }

  /* Model Grid */
  .models-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
    margin-top: 14px;
  }
  .model-card {
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: all 0.2s ease;
  }
  .model-card:hover {
    border-color: #58a6ff;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  }
  .model-card.is-pinned {
    border-color: #855b14;
    background: #14171c;
  }
  .model-card.is-hidden {
    opacity: 0.55;
  }
  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }
  .model-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }
  .model-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .model-raw {
    font-size: 11px;
    color: var(--text-dim);
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-actions {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .btn-icon {
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    border-radius: 6px;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s ease;
    padding: 0;
  }
  .btn-icon:hover {
    background: var(--btn-hover);
    color: var(--text);
    border-color: var(--text-muted);
  }
  .btn-icon.active {
    background: #2b2310;
    border-color: #855b14;
    color: #e3b341;
  }
  .star-btn {
    filter: grayscale(100%);
    opacity: 0.65;
  }
  .star-btn:hover {
    filter: grayscale(30%);
    opacity: 1;
  }
  .star-btn.active {
    background: #2b2310;
    border-color: #855b14;
    color: #e3b341;
    filter: none;
    opacity: 1;
  }
  .badge-pinned {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 10px;
    background: #2b2310;
    color: #e3b341;
    border: 1px solid #855b14;
    font-weight: 500;
  }
  .badge-hidden {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 10px;
    background: #21262d;
    color: var(--text-muted);
    border: 1px solid var(--card-border);
  }
  .progress-track {
    width: 100%;
    height: 8px;
    background: var(--track);
    border-radius: 4px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s ease;
  }
  .model-stats {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 12px;
  }
  .stat-used { color: var(--text-muted); }
  .stat-pct { font-weight: 600; font-variant-numeric: tabular-nums; }
  .model-sub {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: var(--text-muted);
    padding-top: 6px;
    border-top: 1px solid #21262d;
  }
  .stat-rem strong { color: var(--text); }
  .reset-time { color: var(--text-dim); }
  .empty-grid-notice {
    padding: 20px;
    text-align: center;
    color: var(--text-muted);
    background: var(--bg);
    border: 1px dashed var(--card-border);
    border-radius: var(--radius);
    font-size: 12px;
    margin-top: 12px;
  }

  .timestamps {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--card-border);
    color: var(--text-muted);
    font-size: 12px;
  }
  .timestamps strong { color: var(--text); font-weight: 500; }
  .ts-sep { color: #30363d; margin: 0 6px; }
  .error-msg {
    color: var(--red);
    padding: 8px 12px;
    background: #2d1111;
    border: 1px solid #5a1e1e;
    border-radius: 6px;
    font-size: 12px;
    margin-top: 12px;
  }
  .no-data {
    color: var(--text-muted);
    font-size: 12px;
    font-style: italic;
    margin-top: 12px;
  }
  .limit-alert {
    padding: 6px 12px;
    border-radius: 6px;
    font-weight: 600;
    font-size: 12px;
    margin-top: 10px;
  }
  .limit-alert.limit {
    background: #2d1111;
    border: 1px solid #5a1e1e;
    color: var(--red);
  }
  .limit-alert.review {
    background: #2d2200;
    border: 1px solid #5a4400;
    color: var(--yellow);
  }

  /* Tabs Navigation */
  .tabs-header {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--card-border);
    padding-bottom: 8px;
  }
  .tab-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--text-muted);
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .tab-btn:hover {
    background: var(--card-bg);
    color: var(--text);
  }
  .tab-btn.active {
    background: var(--card-bg);
    border-color: var(--card-border);
    border-bottom: 2px solid var(--blue);
    color: var(--text);
    font-weight: 600;
  }
  .tab-content {
    transition: opacity 0.15s ease;
  }

  /* Usage & Analytics Tab */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  .kpi-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    transition: all 0.15s ease;
  }
  .kpi-card:hover {
    border-color: #58a6ff;
  }
  .kpi-title {
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 500;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .kpi-icon {
    font-size: 14px;
  }
  .kpi-value {
    font-size: 22px;
    font-weight: 700;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .kpi-desc {
    font-size: 11px;
    color: var(--text-dim);
  }

  .analytics-box {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius);
    padding: 16px;
  }
  .analytics-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
    flex-wrap: wrap;
    gap: 8px;
  }
  .analytics-title {
    display: flex;
    align-items: center;
  }
  .table-container {
    overflow-x: auto;
  }
  .analytics-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .analytics-table th {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid var(--card-border);
    color: var(--text-muted);
    font-weight: 600;
  }
  .analytics-table td {
    padding: 8px 12px;
    border-bottom: 1px solid #21262d;
    color: var(--text);
  }
  .analytics-empty {
    text-align: center;
    color: var(--text-muted);
    padding: 24px;
    font-style: italic;
  }
  .status-badge {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    display: inline-block;
  }
  .status-badge.success {
    background: #0d2818;
    color: var(--green);
    border: 1px solid #1b4721;
  }
  .status-badge.error {
    background: #2d1111;
    color: var(--red);
    border: 1px solid #5a1e1e;
  }

  /* Live Console Log Tab */
  .console-toolbar {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius);
    padding: 10px 14px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .console-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
  }
  .console-filter-box {
    flex: 1;
    min-width: 200px;
  }
  .console-filter-box input {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text);
    padding: 6px 12px;
    border-radius: var(--radius);
    font-size: 12px;
    outline: none;
    transition: border-color 0.2s ease;
  }
  .console-filter-box input:focus {
    border-color: var(--blue);
  }
  .btn-sm {
    padding: 4px 10px;
    font-size: 12px;
  }
  .btn-danger {
    border-color: #5a1e1e;
    color: var(--red);
  }
  .btn-danger:hover {
    background: #2d1111;
    border-color: var(--red);
  }
  .terminal-box {
    font-family: Consolas, "SF Mono", Monaco, "Courier New", monospace;
    background: #0d1117;
    border: 1px solid var(--card-border);
    padding: 12px;
    border-radius: 6px;
    max-height: 600px;
    height: 520px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.45;
    font-size: 12px;
    color: #c9d1d9;
  }
  .terminal-line {
    display: block;
    margin-bottom: 1px;
    min-height: 18px;
  }
  .log-done { color: #3fb950; font-weight: 500; }
  .log-post { color: #58a6ff; font-weight: 500; }
  .log-refresh { color: #d2a8ff; font-weight: 500; }
  .log-warn { color: #d29922; font-weight: 500; }
  .log-error { color: #f85149; font-weight: 600; }
  .log-default { color: #c9d1d9; }
  .log-system { color: #8b949e; font-style: italic; }

  /* Pagination & Toolbar Controls */
  .pagination-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 0;
    padding: 4px 0;
    flex-wrap: wrap;
  }
  .page-info {
    font-size: 12px;
    color: var(--text-muted);
    padding: 0 4px;
    font-weight: 500;
  }
  .toolbar-group {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .toolbar-label {
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 500;
    white-space: nowrap;
  }
  .toolbar-select {
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text);
    padding: 4px 8px;
    border-radius: var(--radius);
    font-size: 12px;
    outline: none;
    cursor: pointer;
  }
  .toolbar-select:focus {
    border-color: var(--blue);
  }
  .toolbar-date {
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text);
    padding: 3px 6px;
    border-radius: var(--radius);
    font-size: 12px;
    outline: none;
    color-scheme: dark;
  }
  .toolbar-date:focus {
    border-color: var(--blue);
  }
  .btn-xs {
    padding: 2px 8px;
    font-size: 11px;
    min-width: 24px;
    height: 24px;
    line-height: 18px;
    border-radius: var(--radius);
    cursor: pointer;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    color: var(--text);
  }
  .btn-xs:hover {
    border-color: var(--blue);
  }
  .btn-xs.active {
    background: var(--blue);
    border-color: var(--blue);
    color: #fff;
  }
  .btn-xs:disabled, .btn-sm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;
}
