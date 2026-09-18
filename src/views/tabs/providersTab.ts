import * as vscode from 'vscode';
import { DashboardData, ExtensionConfig } from '../../types';
import {
  getHiddenModels,
  getPreferredFilter,
  getPreferredSort
} from '../../services/stateManager';
import {
  escHtml,
  formatCompact,
  formatDate
} from '../../utils/formatters';
import {
  connectionPlan,
  displayName,
  getRemainingPercent,
  getUsedPercent,
  quotaTitle
} from '../../utils/helpers';

export function renderProvidersTab(
  data: DashboardData,
  context: vscode.ExtensionContext,
  cfg: ExtensionConfig,
  pinnedAccountIds: string[],
  pinnedModels: string[],
  initialTab = 'providers'
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
           data-connection-id="${escHtml(connection.id)}"
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

  return `
  <!-- Tab 1: Providers & Quotas -->
  <div id="tab-providers" class="tab-content" style="display: ${initialTab === 'providers' ? 'block' : 'none'};">
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
            .join('\n          ')}
        </div>
        <label class="show-hidden-toggle">
          <input type="checkbox" id="showHiddenCheck"> 👁️ Show hidden models
        </label>
      </div>
      <div class="toolbar-row-settings">
        <div class="setting-item">
          <label for="statusStyleSelect">📊 Status Bar:</label>
          <select id="statusStyleSelect">
            <option value="compact"${(cfg.statusDisplayMode ?? 'compact') === 'compact' ? ' selected' : ''}>Compact (Balanced)</option>
            <option value="detailed"${cfg.statusDisplayMode === 'detailed' ? ' selected' : ''}>Detailed (Full ratio + reset)</option>
            <option value="minimal"${cfg.statusDisplayMode === 'minimal' ? ' selected' : ''}>Minimal (Numbers only)</option>
          </select>
        </div>
        <div class="setting-item">
          <label for="tooltipStyleSelect">📋 Tooltip Detail:</label>
          <select id="tooltipStyleSelect">
            <option value="all"${(cfg.tooltipDisplayMode ?? 'all') === 'all' ? ' selected' : ''}>All (Summary + Accounts)</option>
            <option value="summary"${cfg.tooltipDisplayMode === 'summary' ? ' selected' : ''}>Aggregate Summary Only (Compact)</option>
            <option value="accounts"${cfg.tooltipDisplayMode === 'accounts' ? ' selected' : ''}>Account List Only</option>
          </select>
        </div>
        <div class="setting-item">
          <label for="refreshIntervalSelect">⏱️ Auto-Refresh:</label>
          <select id="refreshIntervalSelect">
            <option value="15"${cfg.intervalSeconds === 15 ? ' selected' : ''}>15 seconds</option>
            <option value="30"${cfg.intervalSeconds === 30 ? ' selected' : ''}>30 seconds</option>
            <option value="60"${cfg.intervalSeconds === 60 ? ' selected' : ''}>60 seconds (Default)</option>
            <option value="120"${cfg.intervalSeconds === 120 ? ' selected' : ''}>2 minutes</option>
            <option value="300"${cfg.intervalSeconds === 300 ? ' selected' : ''}>5 minutes</option>
          </select>
        </div>
      </div>
    </div>

    <div id="sectionsContainer">
      ${sectionsHtml}
    </div>
  </div>`;
}
