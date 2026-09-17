import * as vscode from 'vscode';
import { ExtensionConfig, ProviderUsage } from '../types';
import {
  getCurrentContext,
  getLastDashboard,
  getLastError,
  getPinnedAccountIds,
  getPinnedModels,
  getStatusBarItem,
  setStatusBarItem
} from '../services/stateManager';
import { formatCompact, formatResetCompact } from '../utils/formatters';
import {
  chooseQuotaName,
  displayName,
  formatQuotaForStatus,
  getRemainingPercent,
  quotaShortName,
  truncateName
} from '../utils/helpers';
import { createDashboardTooltip } from './tooltip';

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
  return statusBarItem;
}

export function renderStatusBar(
  cfg: ExtensionConfig,
  missingKey = false
): void {
  const statusBarItem = getStatusBarItem();
  if (!statusBarItem) {
    return;
  }

  if (missingKey) {
    statusBarItem.text = '$(key) 9Router: Not Connected';
    statusBarItem.tooltip = 'Click to setup 9Router URL & Password.';
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
    statusBarItem.text = '$(error) 9Router: Error';
    const errMd = new vscode.MarkdownString(undefined, true);
    errMd.isTrusted = true;
    errMd.appendMarkdown(`### $(error) 9Router: Error\n\n`);
    errMd.appendMarkdown(`> Failed to fetch data: ${lastError}\n\n`);
    errMd.appendMarkdown(
      `[$(gear) Setup Connection](command:aiTokenUsage.setConnection) &nbsp;│&nbsp; [$(refresh) Retry](command:aiTokenUsage.refresh)\n`
    );
    statusBarItem.tooltip = errMd;
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.errorBackground'
    );
    return;
  }

  if (!lastDashboard) {
    statusBarItem.text = '$(sync~spin) 9Router...';
    statusBarItem.tooltip = 'Loading providers and usage statistics...';
    statusBarItem.backgroundColor = undefined;
    return;
  }

  if (lastDashboard.items.length === 0) {
    statusBarItem.text = '$(warning) 9Router: No Providers';
    statusBarItem.tooltip = 'No active provider connections found.';
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
    statusBarItem.text = '$(warning) 9Router: No Providers';
    statusBarItem.tooltip = 'No active provider connections found.';
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
    return;
  }

  let hasError = false;
  let hasWarning = false;

  for (const item of displayItems) {
    const { usage } = item;
    if (!usage || item.error || usage.limitReached) {
      hasError = true;
    } else {
      if (usage.reviewLimitReached) {
        hasWarning = true;
      }
      if (usage.quotas) {
        for (const q of Object.values(usage.quotas)) {
          if (getRemainingPercent(q) <= 15) {
            hasWarning = true;
          }
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

  const mode = cfg.statusDisplayMode ?? 'compact';

  if (displayItems.length > 1) {
    const rawModels =
      pinnedModels.length > 0
        ? pinnedModels
        : [chooseQuotaName(displayItems[0].usage, cfg.statusBarQuota) ?? ''];
    const targetModels = rawModels.filter(Boolean);

    const aggParts: string[] = [];
    for (const m of targetModels) {
      let totalUsed = 0;
      let totalMax = 0;
      let totalRemaining = 0;
      let hasUnlimited = false;
      let found = false;
      let earliestReset: string | undefined;

      for (const item of displayItems) {
        const q = item.usage?.quotas?.[m];
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
        const shortName = quotaShortName(m);
        if (hasUnlimited) {
          const resetStr =
            mode === 'detailed' ? formatResetCompact(earliestReset) : '';
          const resetTag = resetStr ? ` (${resetStr})` : '';
          aggParts.push(`${shortName} ∞${resetTag}`);
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

    const modelsSummary = aggParts.length > 0 ? aggParts.join(' · ') : 'N/A';
    if (mode === 'minimal') {
      statusBarItem.text = `${icon} ${modelsSummary}`;
    } else if (mode === 'compact') {
      statusBarItem.text = `${icon} ${displayItems.length}⭐ · ${modelsSummary}`;
    } else {
      statusBarItem.text = `${icon} ⭐ ${displayItems.length} acc · ${modelsSummary}`;
    }
  } else {
    const item = displayItems[0];
    const { connection, usage } = item;
    const isAccountPinned = pinnedAccountIds.includes(connection.id);
    const accName = truncateName(displayName(connection), 10);

    let targetModelKeys: string[] = [];
    if (pinnedModels.length > 0 && usage?.quotas) {
      targetModelKeys = pinnedModels.filter(
        (m) => usage.quotas[m] !== undefined
      );
    }

    if (targetModelKeys.length === 0) {
      const fallbackModel = chooseQuotaName(usage, cfg.statusBarQuota);
      if (fallbackModel && usage?.quotas && usage.quotas[fallbackModel]) {
        targetModelKeys = [fallbackModel];
      }
    }

    let modelsStr = 'N/A';
    if (usage?.quotas && targetModelKeys.length > 0) {
      modelsStr = targetModelKeys
        .map((key) => formatQuotaForStatus(key, usage.quotas[key], mode))
        .join(' · ');
    }

    if (mode === 'minimal') {
      statusBarItem.text = `${icon} ${modelsStr}`;
    } else {
      statusBarItem.text = `${icon} ${
        isAccountPinned ? '⭐ ' : ''
      }${accName} · ${modelsStr}`;
    }
  }

  statusBarItem.backgroundColor = bg;
  statusBarItem.tooltip = createDashboardTooltip(
    lastDashboard,
    displayItems,
    cfg
  );
}
