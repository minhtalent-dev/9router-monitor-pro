export function renderConsoleLogTab(initialTab = 'providers'): string {
  return `
  <!-- Tab 3: Live Console Log -->
  <div id="tab-console" class="tab-content" style="display: ${initialTab === 'console' ? 'block' : 'none'};">
    <div class="console-toolbar">
      <button id="btnPause" class="btn btn-sm">⏸ Pause</button>
      <button id="btnClearLogs" class="btn btn-sm btn-danger">🗑️ Clear</button>
      <button id="btnReconnectStream" class="btn btn-sm" title="Force reconnect to 9Router Live Console stream">⟳ Reconnect</button>
      <label class="console-label">
        <input type="checkbox" id="chkAutoScroll" checked /> Auto-scroll
      </label>
      <div class="toolbar-group">
        <span class="toolbar-label">Logs:</span>
        <select id="consoleLimitSelect" class="toolbar-select">
          <option value="100">100</option>
          <option value="200">200</option>
          <option value="500" selected>500</option>
          <option value="1000">1000</option>
          <option value="5000">5000</option>
        </select>
      </div>
      <div class="toolbar-group">
        <span class="toolbar-label">Date:</span>
        <input type="date" id="consoleDatePicker" class="toolbar-date" />
        <button id="btnConsoleToday" class="btn btn-xs">Today</button>
        <button id="btnConsoleAll" class="btn btn-xs active">All</button>
      </div>
      <div class="toolbar-group">
        <span class="toolbar-label">Reload:</span>
        <select id="consoleIntervalSelect" class="toolbar-select">
          <option value="1000">1s</option>
          <option value="2000">2s</option>
          <option value="2500" selected>2.5s</option>
          <option value="3000">3s</option>
          <option value="5000">5s</option>
          <option value="10000">10s</option>
          <option value="0">Off</option>
        </select>
      </div>
      <div class="console-filter-box">
        <input type="text" id="txtLogFilter" placeholder="Filter logs (e.g. gpt-4, DONE, error)..." class="search-input" />
      </div>
      <span id="logCountBadge" class="badge">0 logs</span>
      <span id="streamStatusBadge" class="badge" style="background:#238636;color:#fff;margin-left:8px;">● Connecting...</span>
    </div>
    <div class="pagination-bar" id="consolePaginationBar">
      <button id="btnConsoleFirst" class="btn btn-xs" title="First Page">⏮ First</button>
      <button id="btnConsolePrev" class="btn btn-xs" title="Previous Page">◀ Prev</button>
      <span id="consolePageInfo" class="page-info">Page 1 / 1 (0 logs)</span>
      <button id="btnConsoleNext" class="btn btn-xs" title="Next Page">Next ▶</button>
      <button id="btnConsoleLast" class="btn btn-xs" title="Last Page">Last ⏭</button>
      <div class="toolbar-group" style="margin-left:auto;">
        <span class="toolbar-label">Per page:</span>
        <select id="consolePageSizeSelect" class="toolbar-select">
          <option value="50">50</option>
          <option value="100" selected>100</option>
          <option value="200">200</option>
        </select>
      </div>
    </div>
    <div id="terminalContainer" class="terminal-box">
      <div id="terminalEmptyHint" class="terminal-placeholder" style="color:#8b949e;padding:12px;font-style:italic;">Connecting to 9Router Live Console stream... Waiting for incoming logs.</div>
    </div>
  </div>`;
}
