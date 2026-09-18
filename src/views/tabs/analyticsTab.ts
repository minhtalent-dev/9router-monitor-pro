export function renderAnalyticsTab(initialTab = 'providers'): string {
  return `
  <!-- Tab 2: Usage & Analytics -->
  <div id="tab-analytics" class="tab-content" style="display: ${initialTab === 'analytics' ? 'block' : 'none'};">
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-title">Total Requests <span class="kpi-icon">🔢</span></div>
        <div class="kpi-value" id="kpi-requests">0</div>
        <div class="kpi-desc">All-time routed requests</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Prompt Tokens (In) <span class="kpi-icon">📥</span></div>
        <div class="kpi-value" id="kpi-in-tokens">0</div>
        <div class="kpi-desc">Input context tokens</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Cached Tokens <span class="kpi-icon">⚡</span></div>
        <div class="kpi-value" id="kpi-cached-tokens">0</div>
        <div class="kpi-desc">Prompt cache hits</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Completion Tokens (Out) <span class="kpi-icon">📤</span></div>
        <div class="kpi-value" id="kpi-out-tokens">0</div>
        <div class="kpi-desc">Generated output tokens</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Est. Cost <span class="kpi-icon">💵</span></div>
        <div class="kpi-value" id="kpi-cost">$0.0000</div>
        <div class="kpi-desc">Estimated USD expense</div>
      </div>
    </div>

    <div class="analytics-box">
      <div class="analytics-header">
        <div class="analytics-title">
          <span style="font-size: 15px; font-weight: 600;">🕒 Recent Requests</span>
        </div>
        <div class="toolbar-group">
          <span class="toolbar-label">Limit:</span>
          <select id="analyticsLimitSelect" class="toolbar-select">
            <option value="20">20</option>
            <option value="50" selected>50</option>
            <option value="100">100</option>
            <option value="200">200</option>
            <option value="500">500</option>
          </select>
        </div>
        <div class="toolbar-group">
          <span class="toolbar-label">Date:</span>
          <input type="date" id="analyticsDatePicker" class="toolbar-date" />
          <button id="btnAnalyticsToday" class="btn btn-xs">Today</button>
          <button id="btnAnalyticsAll" class="btn btn-xs active">All</button>
        </div>
        <div class="toolbar-group">
          <span class="toolbar-label">Reload:</span>
          <select id="analyticsIntervalSelect" class="toolbar-select">
            <option value="0" selected>Off</option>
            <option value="5000">5s</option>
            <option value="10000">10s</option>
            <option value="30000">30s</option>
            <option value="60000">60s</option>
          </select>
        </div>
        <button id="btnRefreshAnalytics" class="btn btn-sm">⟳ Refresh Analytics</button>
      </div>
      <div class="table-container">
        <table class="analytics-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Model</th>
              <th>Provider</th>
              <th>Account</th>
              <th>Input / Output</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="analyticsTableBody">
            <tr>
              <td colspan="6" class="analytics-empty">Click 'Refresh Analytics' to load data...</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination-bar" id="analyticsPaginationBar">
        <button id="btnAnalyticsFirst" class="btn btn-xs" title="First Page">⏮ First</button>
        <button id="btnAnalyticsPrev" class="btn btn-xs" title="Previous Page">◀ Prev</button>
        <span id="analyticsPageInfo" class="page-info">Page 1 / 1 (0 requests)</span>
        <button id="btnAnalyticsNext" class="btn btn-xs" title="Next Page">Next ▶</button>
        <button id="btnAnalyticsLast" class="btn btn-xs" title="Last Page">Last ⏭</button>
      </div>
    </div>
  </div>`;
}
