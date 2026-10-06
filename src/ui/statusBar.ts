import * as vscode from 'vscode';
import { ExtensionConfig, ProviderUsage } from '../types';
import {
  getCurrentContext,
  getLastDashboard,
  getLastError,
  getLastRecentLogs,
  getLastUsageStats,
  getLogStatusBarItem,
  getLogTooltipLimit,
  getPinnedAccountIds,
  getPinnedModels,
  getStatusBarItem,
  setLogStatusBarItem,
  setStatusBarItem
} from '../services/stateManager';
import { formatCompact, formatResetCompact } from '../utils/formatters';
import {
  chooseQuotaName,
  collectActiveModelNames,
  displayName,
  findMatchingQuota,
  formatQuotaForStatus,
  getRemainingPercent,
  quotaShortName,
  truncateName
} from '../utils/helpers';
import { createDashboardTooltip, createLogStatusBarTooltip } from './tooltip';

export function initStatusBar(
  context: vscode.ExtensionContext
): vscode.StatusBarItem {
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'aiTokenUsage.openQuickMenu';
  setStatusBarItem(statusBarItem);
  context.subscriptions.push(statusBarItem);
  statusBarItem.show();

  const logItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99
  );
  logItem.command = 'aiTokenUsage.openConsoleLog';
  logItem.text = '$(terminal) ';
  logItem.tooltip = 'Click to open 9Router Live Console Log';
  setLogStatusBarItem(logItem);
  context.subscriptions.push(logItem);

  return statusBarItem;
}

// Chống nháy (Anti-flicker Diffing Guard): Chỉ cập nhật khi nội dung thực sự thay đổi
function updateStatusBarTooltip(
  item: vscode.StatusBarItem,
  nextTooltip: vscode.MarkdownString | string | undefined
): void {
  if (!item.tooltip) {
    item.tooltip = nextTooltip;
    return;
  }
  const currentStr =
    typeof item.tooltip === 'string' ? item.tooltip : item.tooltip.value;
  const nextStr =
    typeof nextTooltip === 'string' ? nextTooltip : nextTooltip?.value;

  if (currentStr !== nextStr) {
    item.tooltip = nextTooltip;
  }
}

function updateStatusBarText(
  item: vscode.StatusBarItem,
  nextText: string
): void {
  if (item.text !== nextText) {
    item.text = nextText;
  }
}

export function renderLogStatusBar(cfg: ExtensionConfig): void {
  const logItem = getLogStatusBarItem();
  if (!logItem) return;

  if (cfg.showLogStatusBar !== false) {
    logItem.show();
  } else {
    logItem.hide();
  }
  const stats = getLastUsageStats();
  const logs = getLastRecentLogs();
  const limit = getLogTooltipLimit();
  const tooltipMode = cfg.logTooltipDisplayMode ?? 'all';
  const nextTooltip = createLogStatusBarTooltip(stats, logs, limit, tooltipMode);
  updateStatusBarTooltip(logItem, nextTooltip);

  const logStyle = cfg.logStatusDisplayMode ?? 'minimal';
  const totalReq = formatCompact(stats?.totalRequests ?? 0);
  const cost = Math.round(Number(stats?.totalCost || 0));
  const lastLog = logs && logs.length > 0 ? logs[0] : undefined;

  let pulse = '';
  let lastModelStr = '';
  let lastTokensStr = '';
  let hasRecentError = false;

  if (lastLog) {
    const isOk =
      (lastLog.status || '').toLowerCase() === 'ok' ||
      lastLog.status === '200' ||
      lastLog.status === 'success';
    pulse = isOk ? '🟢' : '🔴';
    hasRecentError = !isOk;
    lastModelStr = quotaShortName(lastLog.model || '');
    const inStr = formatCompact(lastLog.inTokens ?? 0);
    const outStr = formatCompact(lastLog.outTokens ?? 0);
    lastTokensStr = `${inStr}/${outStr}`;
  }

  let nextText = '$(terminal) ';
  if (logStyle === 'compact') {
    const parts: string[] = [];
    if (stats?.totalRequests) {
      parts.push(`${totalReq} req`);
    }
    if (lastModelStr) {
      parts.push(`${lastModelStr} ${pulse}`.trim());
    } else if (pulse) {
      parts.push(pulse);
    }
    const suffix = parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
    nextText = `$(terminal) ${suffix}`;
  } else if (logStyle === 'detailed') {
    const parts: string[] = [];
    if (stats?.totalRequests) {
      parts.push(`${totalReq} req`);
    }
    if (stats?.totalCost !== undefined) {
      parts.push(`$${cost}`);
    }
    if (lastModelStr && lastTokensStr) {
      parts.push(`${lastModelStr} ${lastTokensStr} ${pulse}`.trim());
    } else if (lastModelStr) {
      parts.push(`${lastModelStr} ${pulse}`.trim());
    } else if (pulse) {
      parts.push(pulse);
    }
    const suffix = parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
    nextText = `$(terminal) ${suffix}`;
  }

  updateStatusBarText(logItem, nextText);

  if (hasRecentError) {
    logItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    logItem.backgroundColor = undefined;
  }
}

export function renderQuotaStatusBar(
  cfg: ExtensionConfig,
  missingKey = false
): void {
  const statusBarItem = getStatusBarItem();
  if (!statusBarItem) {
    return;
  }

  if (missingKey) {
    updateStatusBarText(statusBarItem, '$(key) 9Router: Not Connected');
    updateStatusBarTooltip(statusBarItem, 'Click to setup 9Router URL & Password.');
    statusBarItem.command = 'aiTokenUsage.setConnection';
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
    return;
  }

  statusBarItem.command = 'aiTokenUsage.openQuickMenu';

  const lastError = getLastError();
  const lastDashboard = getLastDashboard();

  if (lastError && !lastDashboard) {
    updateStatusBarText(statusBarItem, '$(error) 9Router: Error');
    const errMd = new vscode.MarkdownString(undefined, true);
    errMd.isTrusted = true;
    errMd.appendMarkdown(`### $(error) 9Router: Error\n\n`);
    errMd.appendMarkdown(`> Failed to fetch data: ${lastError}\n\n`);
    errMd.appendMarkdown(
      `[$(gear) Setup Connection](command:aiTokenUsage.setConnection) &nbsp;│&nbsp; [$(refresh) Retry](command:aiTokenUsage.refresh)\n`
    );
    updateStatusBarTooltip(statusBarItem, errMd);
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.errorBackground'
    );
    return;
  }

  if (!lastDashboard) {
    updateStatusBarText(statusBarItem, '$(sync~spin) 9Router...');
    updateStatusBarTooltip(statusBarItem, 'Loading providers and usage statistics...');
    statusBarItem.backgroundColor = undefined;
    return;
  }

  if (lastDashboard.items.length === 0) {
    updateStatusBarText(statusBarItem, '$(warning) 9Router: No Providers');
    updateStatusBarTooltip(statusBarItem, 'No active provider connections found.');
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
    return;
  }

  const currentContext = getCurrentContext();
  const pinnedAccountIds = currentContext
    ? getPinnedAccountIds(currentContext)
    : [];
  const pinnedModels = currentContext ? getPinnedModels(currentContext) : [];

  let displayItems: ProviderUsage[] = [];
  if (pinnedAccountIds.length > 0) {
    displayItems = lastDashboard.items.filter((it) =>
      pinnedAccountIds.includes(it.connection.id)
    );
  }
  if (displayItems.length === 0) {
    const fallback = lastDashboard.primary ?? lastDashboard.items[0];
    if (fallback) {
      displayItems = [fallback];
    }
  }

  if (displayItems.length === 0) {
    updateStatusBarText(statusBarItem, '$(warning) 9Router: No Providers');
    updateStatusBarTooltip(statusBarItem, 'No active provider connections found.');
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
    return;
  }

  let hasError = false;
  let hasWarning = false;

  const mode = cfg.statusDisplayMode ?? 'compact';

  if (displayItems.length > 1) {
    const rawModels =
      pinnedModels.length > 0
        ? pinnedModels
        : [chooseQuotaName(displayItems[0].usage, cfg.statusBarQuota) ?? ''];

    const hasAnyMatch = rawModels.some((m) =>
      displayItems.some(
        (it) => findMatchingQuota(it.usage?.quotas, m) !== undefined
      )
    );

    let targetModels: string[] = [];
    if (hasAnyMatch) {
      targetModels = rawModels.filter(Boolean);
    } else {
      const fallbackModels = collectActiveModelNames(displayItems, 3);
      targetModels =
        fallbackModels.length > 0 ? fallbackModels : rawModels.filter(Boolean);
    }

    if (displayItems.every((it) => !it.usage || it.error)) {
      hasError = true;
    }

    const aggParts: string[] = [];
    for (const m of targetModels) {
      let totalUsed = 0;
      let totalMax = 0;
      let totalRemaining = 0;
      let hasUnlimited = false;
      let found = false;
      let earliestReset: string | undefined;

      for (const item of displayItems) {
        const match = findMatchingQuota(item.usage?.quotas, m);
        const q = match?.quota;
        if (q) {
          found = true;
          totalUsed += q.used;
          totalMax += q.total;
          totalRemaining += q.remaining;
          if (q.unlimited) {
            hasUnlimited = true;
          }
          if (q.resetAt) {
            if (
              !earliestReset ||
              new Date(q.resetAt).getTime() < new Date(earliestReset).getTime()
            ) {
              earliestReset = q.resetAt;
            }
          }
        }
      }

      if (found) {
        if (!hasUnlimited && totalMax > 0) {
          const remPct = (totalRemaining / totalMax) * 100;
          if (remPct <= 5) {
            hasError = true;
          } else if (remPct <= 15) {
            hasWarning = true;
          }
        }
        const shortName = quotaShortName(m);
        if (hasUnlimited) {
          const resetStr =
            mode === 'detailed' ? formatResetCompact(earliestReset) : '';
          const resetTag = resetStr ? ` (${resetStr})` : '';
          aggParts.push(`${shortName} ∞${resetTag}`);
        } else if (totalMax <= 0) {
          aggParts.push(`${shortName} —`);
        } else if (mode === 'detailed') {
          const resetStr = formatResetCompact(earliestReset);
          const resetTag = resetStr ? ` (${resetStr})` : '';
          aggParts.push(
            `${shortName} ${formatCompact(totalRemaining)}/${formatCompact(
              totalMax
            )}${resetTag}`
          );
        } else {
          aggParts.push(`${shortName} ${formatCompact(totalRemaining)}`);
        }
      }
    }

    let icon = '$(graph)';
    let bg: vscode.ThemeColor | undefined;
    if (hasError) {
      icon = '$(error)';
      bg = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (hasWarning) {
      icon = '$(warning)';
      bg = new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    const modelsSummary = aggParts.length > 0 ? aggParts.join(' · ') : 'N/A';
    if (mode === 'minimal') {
      updateStatusBarText(statusBarItem, `${icon} ${modelsSummary}`);
    } else if (mode === 'compact') {
      updateStatusBarText(statusBarItem, `${icon} ${displayItems.length}⭐ · ${modelsSummary}`);
    } else {
      updateStatusBarText(statusBarItem, `${icon} ⭐ ${displayItems.length} acc · ${modelsSummary}`);
    }
    statusBarItem.backgroundColor = bg;
  } else {
    const item = displayItems[0];
    const { connection, usage } = item;
    const isAccountPinned = pinnedAccountIds.includes(connection.id);
    const accName = truncateName(displayName(connection), 10);

    if (!usage || item.error || usage.limitReached) {
      hasError = true;
    } else if (usage.reviewLimitReached) {
      hasWarning = true;
    }

    let targetModelKeys: string[] = [];
    if (pinnedModels.length > 0 && usage?.quotas) {
      for (const m of pinnedModels) {
        const match = findMatchingQuota(usage.quotas, m);
        if (match && !targetModelKeys.includes(match.key)) {
          targetModelKeys.push(match.key);
        }
      }
    }

    if (targetModelKeys.length === 0) {
      const fallbackModel = chooseQuotaName(usage, cfg.statusBarQuota);
      if (fallbackModel && usage?.quotas) {
        const match = findMatchingQuota(usage.quotas, fallbackModel);
        if (match) {
          targetModelKeys = [match.key];
        }
      }
    }

    if (usage?.quotas) {
      for (const key of targetModelKeys) {
        const match = findMatchingQuota(usage.quotas, key);
        const q = match?.quota ?? usage.quotas[key];
        if (q && !q.unlimited && q.total > 0) {
          const remPct = (q.remaining / q.total) * 100;
          if (remPct <= 5) {
            hasError = true;
          } else if (remPct <= 15) {
            hasWarning = true;
          }
        }
      }
    }

    let icon = '$(graph)';
    let bg: vscode.ThemeColor | undefined;
    if (hasError) {
      icon = '$(error)';
      bg = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (hasWarning) {
      icon = '$(warning)';
      bg = new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    let modelsStr = 'N/A';
    if (usage?.quotas && targetModelKeys.length > 0) {
      modelsStr = targetModelKeys
        .map((key) => {
          const match = findMatchingQuota(usage.quotas, key);
          const q = match?.quota ?? usage.quotas[key];
          return formatQuotaForStatus(match?.key ?? key, q, mode);
        })
        .join(' · ');
    }

    if (mode === 'minimal') {
      updateStatusBarText(statusBarItem, `${icon} ${modelsStr}`);
    } else {
      updateStatusBarText(statusBarItem, `${icon} ${
        isAccountPinned ? '⭐ ' : ''
      }${accName} · ${modelsStr}`);
    }
    statusBarItem.backgroundColor = bg;
  }
  const nextTooltip = createDashboardTooltip(
    lastDashboard,
    displayItems,
    cfg
  );
  updateStatusBarTooltip(statusBarItem, nextTooltip);
}

export function renderStatusBar(
  cfg: ExtensionConfig,
  missingKey = false
): void {
  renderLogStatusBar(cfg);
  renderQuotaStatusBar(cfg, missingKey);
}

