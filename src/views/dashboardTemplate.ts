import * as vscode from 'vscode';
import { DashboardData, ExtensionConfig } from '../types';
import {
  getHiddenModels,
  getPinnedAccountIds,
  getPinnedModels,
  getPreferredFilter,
  getPreferredSort
} from '../services/stateManager';
import {
  escHtml,
  formatCompact,
  formatDate
} from '../utils/formatters';
import {
  connectionPlan,
  displayName,
  getRemainingPercent,
  getUsedPercent,
  quotaTitle
} from '../utils/helpers';

export function getWebviewContent(
  data: DashboardData,
  context: vscode.ExtensionContext,
  cfg: ExtensionConfig,
  pinnedAccountIds = getPinnedAccountIds(context),
  pinnedModels = getPinnedModels(context)
): string {
  const hiddenModels = getHiddenModels(context);
  const preferredSort = getPreferredSort(context);
  const preferredFilter = getPreferredFilter(context);

  const providerSet = new Set<string>();
  for (const it of data.items) {
    if (it.connection.provider) {
      providerSet.add(it.connection.provider);
    }
  }
  const uniqueProviders = Array.from(providerSet).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  let sectionsHtml = '';

  for (const item of data.items) {
    const { connection, usage } = item;
    const isPrimary = connection.priority === 1;
    const isPinnedAcc = pinnedAccountIds.includes(connection.id);
    const nameLabel = escHtml(displayName(connection));
    const plan = usage?.plan ?? connectionPlan(connection);

    let badgesHtml = `<span class="badge priority">#${connection.priority}</span>`;
    badgesHtml += `<span class="badge provider">${escHtml(connection.provider)}</span>`;
    if (connection.authType) {
      badgesHtml += `<span class="badge">${escHtml(connection.authType)}</span>`;
    }
    if (plan) {
      badgesHtml += `<span class="badge plan">${escHtml(plan)}</span>`;
    }

    const pinAccountBtnHtml = isPinnedAcc
      ? `<button class="pinned-account-btn active" data-account-id="${escHtml(
          connection.id
        )}" title="Unpin account from Status Bar">★ Pinned</button>`
      : `<button class="pinned-account-btn" data-account-id="${escHtml(
          connection.id
        )}" title="Pin account to Status Bar">☆ Pin Account</button>`;

    const toggleBtnHtml = connection.isActive
      ? `<button class="toggle-btn active" data-connection-id="${escHtml(
          connection.id
        )}" data-active="true" title="Click to disable this account">✓ Active</button>`
      : `<button class="toggle-btn inactive" data-connection-id="${escHtml(
          connection.id
        )}" data-active="false" title="Click to enable this account">✗ Inactive</button>`;

    let bodyHtml = '';
    if (item.error) {
      bodyHtml = `<div class="error-msg">⚠ Error: ${escHtml(item.error)}</div>`;
    } else if (!usage) {
      bodyHtml = '<div class="no-data">No usage data available</div>';
    } else {
      let alertsHtml = '';
      if (item.warning) {
        alertsHtml += `<div class="limit-alert review" style="margin-bottom:8px;">⏱️ ${escHtml(item.warning)}</div>`;
      }
      if (usage.limitReached) {
        alertsHtml += '<div class="limit-alert limit">🔴 LIMIT REACHED!</div>';
      }
      if (usage.reviewLimitReached) {
        alertsHtml +=
          '<div class="limit-alert review">🟡 Review Limit Reached</div>';
      }

      let cardsHtml = '';
      const quotasList = Object.entries(usage.quotas);

      for (const [name, quota] of quotasList) {
        const isPinned = pinnedModels.includes(name);
        const isHidden = hiddenModels.includes(name);
        const usedPct = getUsedPercent(quota);
        const remPct = getRemainingPercent(quota);
        const title = quotaTitle(name);
        const raw = name;
        const resetMs = quota.resetAt
          ? new Date(quota.resetAt).getTime() || 0
          : 0;

        let barColor = 'var(--green)';
        if (usedPct >= 95) {
          barColor = 'var(--red)';
        } else if (usedPct >= 85) {
          barColor = 'var(--yellow)';
        }

        const resetText = quota.resetAt
          ? `🔄 Reset: ${escHtml(formatDate(quota.resetAt))}`
          : quota.unlimited
          ? 'Unlimited'
          : '';

        cardsHtml += `
          <div class="model-card${isPinned ? ' is-pinned' : ''}${
          isHidden ? ' is-hidden' : ''
        }"
               data-model="${escHtml(raw.toLowerCase())}"
               data-title="${escHtml(title.toLowerCase())}"
               data-used="${quota.used}"
               data-total="${quota.total}"
               data-pct="${usedPct}"
               data-remaining="${quota.remaining}"
               data-reset="${resetMs}"
               data-hidden="${isHidden ? 'true' : 'false'}"
               data-pinned="${isPinned ? 'true' : 'false'}">
            <div class="card-top">
              <div class="model-info">
                <div class="model-title" title="${escHtml(title)}">${escHtml(
          title
        )}</div>
                <div class="model-raw" title="${escHtml(raw)}">${escHtml(
          raw
        )}</div>
              </div>
              <div class="card-actions">
                ${isPinned ? '<span class="badge-pinned">⭐ Pinned</span>' : ''}
                ${isHidden ? '<span class="badge-hidden">Hidden</span>' : ''}
                <button class="btn-icon star-btn${
                  isPinned ? ' active' : ''
                }" data-model="${escHtml(
          raw
        )}" title="${isPinned ? 'Unpin from Status Bar' : 'Pin to Status Bar'}">⭐</button>
                <button class="btn-icon hide-btn${
                  isHidden ? ' active' : ''
                }" data-model="${escHtml(
          raw
        )}" title="${isHidden ? 'Unhide model' : 'Hide model'}">${isHidden ? '🙈' : '👁️'}</button>
              </div>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width:${usedPct}%;background:${barColor};"></div>
            </div>
            <div class="model-stats">
              <span class="stat-used">${formatCompact(quota.used)} / ${
          quota.unlimited ? '∞' : formatCompact(quota.total)
        } used</span>
              <span class="stat-pct" style="color:${barColor};">${usedPct.toFixed(
          1
        )}%</span>
            </div>
            <div class="model-sub">
              <span class="stat-rem">Remaining: <strong>${
                quota.unlimited ? '∞' : formatCompact(quota.remaining)
              }</strong> (${remPct.toFixed(1)}%)</span>
              <span class="reset-time">${resetText}</span>
            </div>
          </div>`;
      }

      bodyHtml = `
        ${alertsHtml}
        <div class="models-grid">
          ${cardsHtml}
        </div>
        <div class="empty-grid-notice" style="display:none;">No models match current filter.</div>`;
    }

    let tsHtml = '';
    const tsItems: string[] = [];
    if (connection.lastUsedAt) {
      tsItems.push(
        `<span>🕐 Last used: <strong>${escHtml(
          formatDate(connection.lastUsedAt)
        )}</strong></span>`
      );
    }
    if (connection.lastRefreshAt) {
      tsItems.push(
        `<span>🔄 Refresh: <strong>${escHtml(
          formatDate(connection.lastRefreshAt)
        )}</strong></span>`
      );
    }
    if (connection.expiresAt) {
      tsItems.push(
        `<span>📅 Expires: <strong>${escHtml(
          formatDate(connection.expiresAt)
        )}</strong></span>`
      );
    }
    if (tsItems.length > 0) {
      tsHtml = `<div class="timestamps">${tsItems.join(
        '<span class="ts-sep">│</span>'
      )}</div>`;
    }

    sectionsHtml += `
      <div class="provider-section${isPrimary ? ' primary' : ''}${
      isPinnedAcc ? ' pinned-account' : ''
    }"
           data-provider="${escHtml(connection.provider.toLowerCase())}"
           data-name="${escHtml(displayName(connection).toLowerCase())}"
           data-priority="${connection.priority}">
        <div class="provider-header">
          <div class="provider-title">
            <span class="star">${isPinnedAcc ? '⭐' : isPrimary ? '📌' : '👤'}</span>
            <span class="name">${nameLabel}</span>
          </div>
          <div class="provider-header-actions">
            ${pinAccountBtnHtml}
            ${toggleBtnHtml}
            <div class="badges">${badgesHtml}</div>
          </div>
        </div>
        <div class="provider-body">
          ${bodyHtml}
        </div>
        ${tsHtml}
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
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
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1><span class="logo">📊</span> 9Router Monitor Pro</h1>
      <div class="updated">Updated: ${escHtml(formatDate(data.fetchedAt.toISOString()))} · Auto-refresh: ${cfg.intervalSeconds}s</div>
    </div>
    <div class="header-actions">
      <button class="btn btn-primary" id="refreshBtn">⟳ Refresh</button>
      <button class="btn" id="setConnectionBtn">⚙ Setup Connection</button>
    </div>
  </div>

  <div class="toolbar">
    <div class="toolbar-row-top">
      <div class="search-box">
        <input type="text" id="searchInput" placeholder="🔍 Search model... (e.g. gemini, claude, sonnet, 3.8)">
      </div>
      <div class="sort-box">
        <select id="sortSelect">
          <option value="used_desc"${preferredSort === 'used_desc' ? ' selected' : ''}>Sort: Highest Usage (% desc)</option>
          <option value="used_asc"${preferredSort === 'used_asc' ? ' selected' : ''}>Sort: Lowest Usage (% asc)</option>
          <option value="remaining_desc"${preferredSort === 'remaining_desc' ? ' selected' : ''}>Sort: Most Remaining Quota</option>
          <option value="name_asc"${preferredSort === 'name_asc' ? ' selected' : ''}>Sort: Model Name (A → Z)</option>
          <option value="provider_asc"${preferredSort === 'provider_asc' ? ' selected' : ''}>Sort: Provider (A → Z)</option>
          <option value="account_asc"${preferredSort === 'account_asc' ? ' selected' : ''}>Sort: Account Name (A → Z)</option>
          <option value="reset_asc"${preferredSort === 'reset_asc' ? ' selected' : ''}>Sort: Nearest Reset Time</option>
        </select>
      </div>
    </div>
    <div class="toolbar-row-bottom">
      <div class="filter-chips">
        <button class="filter-chip${preferredFilter === 'all' ? ' active' : ''}" data-filter="all">All</button>
        <button class="filter-chip${preferredFilter === 'active' ? ' active' : ''}" data-filter="active">In Use (>0%)</button>
        <button class="filter-chip${preferredFilter === 'claude' ? ' active' : ''}" data-filter="claude">Claude</button>
        <button class="filter-chip${preferredFilter === 'gemini' ? ' active' : ''}" data-filter="gemini">Gemini</button>
        <button class="filter-chip${preferredFilter === 'other' ? ' active' : ''}" data-filter="other">Other</button>
        ${uniqueProviders
          .map((p) => {
            const fKey = 'provider:' + p.toLowerCase();
            const isActive = preferredFilter === fKey;
            return `<button class="filter-chip${
              isActive ? ' active' : ''
            }" data-filter="${escHtml(fKey)}">${escHtml(p)}</button>`;
          })
          .join('\n        ')}
      </div>
      <label class="show-hidden-toggle">
        <input type="checkbox" id="showHiddenCheck"> 👁️ Show hidden models
      </label>
    </div>
  </div>

  <div id="sectionsContainer">
    ${sectionsHtml}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let activeFilter = ${JSON.stringify(preferredFilter)};
    const searchInput = document.getElementById('searchInput');
    const sortSelect = document.getElementById('sortSelect');
    const showHiddenCheck = document.getElementById('showHiddenCheck');
    const chips = document.querySelectorAll('.filter-chip');

    document.getElementById('refreshBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });
    document.getElementById('setConnectionBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'setConnection' });
    });

    document.addEventListener('click', (e) => {
      const pinAccBtn = e.target.closest('.pinned-account-btn, .pin-account-btn');
      if (pinAccBtn) {
        const accountId = pinAccBtn.dataset.accountId;
        if (accountId) {
          vscode.postMessage({ command: 'togglePinAccount', accountId: accountId });
        }
        return;
      }
      const toggleBtn = e.target.closest('.toggle-btn');
      if (toggleBtn) {
        const connId = toggleBtn.dataset.connectionId;
        const currentActive = toggleBtn.dataset.active === 'true';
        if (connId) {
          vscode.postMessage({
            command: 'toggleProviderActive',
            connectionId: connId,
            newActive: !currentActive
          });
        }
        return;
      }
      const starBtn = e.target.closest('.star-btn, .pin-btn');
      if (starBtn) {
        const model = starBtn.dataset.model;
        if (model) {
          vscode.postMessage({ command: 'togglePinModel', modelName: model });
        }
        return;
      }
      const hideBtn = e.target.closest('.hide-btn');
      if (hideBtn) {
        const model = hideBtn.dataset.model;
        if (model) {
          vscode.postMessage({ command: 'toggleHide', model: model });
        }
        return;
      }
    });

    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        activeFilter = chip.dataset.filter;
        vscode.postMessage({ command: 'updateFilter', filter: activeFilter });
        applyFiltersAndSort();
      });
    });

    searchInput.addEventListener('input', () => {
      applyFiltersAndSort();
    });

    sortSelect.addEventListener('change', () => {
      vscode.postMessage({ command: 'updateSort', sort: sortSelect.value });
      applyFiltersAndSort();
    });

    showHiddenCheck.addEventListener('change', () => {
      applyFiltersAndSort();
    });

    function applyFiltersAndSort() {
      const query = (searchInput.value || '').trim().toLowerCase();
      const showHidden = showHiddenCheck.checked;
      const sortMode = sortSelect.value;
      const isProviderFilter = activeFilter.startsWith('provider:');
      const targetProvider = isProviderFilter ? activeFilter.replace('provider:', '') : null;

      const container = document.getElementById('sectionsContainer');
      const sections = Array.from(document.querySelectorAll('.provider-section'));

      sections.forEach(section => {
        const prov = (section.dataset.provider || '').toLowerCase();
        const accName = (section.dataset.name || '').toLowerCase();

        if (targetProvider && prov !== targetProvider) {
          section.style.display = 'none';
          return;
        }
        section.style.display = '';

        const grid = section.querySelector('.models-grid');
        if (!grid) return;
        const cards = Array.from(grid.querySelectorAll('.model-card'));
        let visibleCount = 0;

        cards.forEach(card => {
          const model = card.dataset.model || '';
          const title = card.dataset.title || '';
          const used = parseFloat(card.dataset.used || '0');
          const isHidden = card.dataset.hidden === 'true';

          const matchesSearch = !query || model.includes(query) || title.includes(query) || accName.includes(query) || prov.includes(query);
          let matchesCategory = true;
          if (activeFilter === 'active') {
            matchesCategory = used > 0;
          } else if (activeFilter === 'claude') {
            matchesCategory = model.includes('claude') || title.includes('claude');
          } else if (activeFilter === 'gemini') {
            matchesCategory = model.includes('gemini') || title.includes('gemini');
          } else if (activeFilter === 'other') {
            matchesCategory = !model.includes('claude') && !title.includes('claude') && !model.includes('gemini') && !title.includes('gemini');
          }

          const matchesHidden = showHidden || !isHidden;

          if (matchesSearch && matchesCategory && matchesHidden) {
            card.style.display = '';
            visibleCount++;
          } else {
            card.style.display = 'none';
          }
        });

        cards.sort((a, b) => {
          if (sortMode === 'used_desc') {
            return parseFloat(b.dataset.pct || '0') - parseFloat(a.dataset.pct || '0');
          }
          if (sortMode === 'used_asc') {
            return parseFloat(a.dataset.pct || '0') - parseFloat(b.dataset.pct || '0');
          }
          if (sortMode === 'remaining_desc') {
            return parseFloat(b.dataset.remaining || '0') - parseFloat(a.dataset.remaining || '0');
          }
          if (sortMode === 'name_asc') {
            return (a.dataset.title || '').localeCompare(b.dataset.title || '');
          }
          if (sortMode === 'reset_asc') {
            const ra = parseFloat(a.dataset.reset || '0');
            const rb = parseFloat(b.dataset.reset || '0');
            if (ra === 0) return 1;
            if (rb === 0) return -1;
            return ra - rb;
          }
          return 0;
        });

        cards.forEach(card => grid.appendChild(card));

        const notice = section.querySelector('.empty-grid-notice');
        if (notice) {
          notice.style.display = visibleCount === 0 ? 'block' : 'none';
        }
      });

      if (container) {
        if (sortMode === 'provider_asc') {
          sections.sort((a, b) => (a.dataset.provider || '').localeCompare(b.dataset.provider || ''));
          sections.forEach(s => container.appendChild(s));
        } else if (sortMode === 'account_asc') {
          sections.sort((a, b) => (a.dataset.name || '').localeCompare(b.dataset.name || ''));
          sections.forEach(s => container.appendChild(s));
        }
      }
    }

    applyFiltersAndSort();
  </script>
</body>
</html>`;
}
