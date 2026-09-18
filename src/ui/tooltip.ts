import * as vscode from 'vscode';
import {
  DashboardData,
  ExtensionConfig,
  ProviderUsage,
  RequestLogItem,
  UsageStats
} from '../types';
import {
  getCurrentContext,
  getLastError,
  getPinnedAccountIds,
  getPinnedModels
} from '../services/stateManager';
import {
  formatCompact,
  formatResetCompact,
  getHealthIcon,
  renderTextBar
} from '../utils/formatters';
import {
  chooseQuotaName,
  connectionPlan,
  displayName,
  getRemainingPercent,
  getUsedPercent,
  quotaTitle,
  truncateName
} from '../utils/helpers';

export function createDashboardTooltip(
  data: DashboardData,
  displayItems: ProviderUsage[] | undefined,
  cfg: ExtensionConfig
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = {
    enabledCommands: [
      'aiTokenUsage.openQuickMenu',
      'aiTokenUsage.showDetails',
      'aiTokenUsage.setTooltipMode',
      'aiTokenUsage.toggleTooltipMode',
      'aiTokenUsage.setDisplayMode',
      'aiTokenUsage.setConnection',
      'aiTokenUsage.refresh'
    ]
  };
  md.supportHtml = true;

  const currentContext = getCurrentContext();
  const pinnedAccountIds = currentContext
    ? getPinnedAccountIds(currentContext)
    : [];
  const pinnedModels = currentContext ? getPinnedModels(currentContext) : [];

  let targets = displayItems;
  if (!targets || targets.length === 0) {
    if (pinnedAccountIds.length > 0) {
      targets = data.items.filter((it) =>
        pinnedAccountIds.includes(it.connection.id)
      );
    }
    if (!targets || targets.length === 0) {
      targets = data.items.length > 0 ? [data.primary ?? data.items[0]] : [];
    }
  }

  if (targets.length === 0) {
    md.appendMarkdown(
      '### $(graph) 9Router Monitor Pro\n\nNo active provider connections found.'
    );
    return md;
  }

  md.appendMarkdown('### $(graph) 9Router Monitor Pro\n\n');
  const lastError = getLastError();
  if (lastError) {
    md.appendMarkdown(`> $(warning) Error: ${lastError}\n\n`);
  }

  if (targets.length > 1) {
    const rawModels =
      pinnedModels.length > 0
        ? pinnedModels
        : [chooseQuotaName(targets[0]?.usage, cfg.statusBarQuota) ?? ''];
    const modelsToTrack = rawModels.filter(Boolean);

    const tooltipMode = cfg.tooltipDisplayMode ?? 'all';
    const showSummary = tooltipMode === 'all' || tooltipMode === 'summary';
    const showAccounts = tooltipMode === 'all' || tooltipMode === 'accounts';

    // Aggregate Summary
    if (showSummary) {
      md.appendMarkdown('**Aggregate Summary**\n\n');
      md.appendMarkdown('| Model | Remaining / Total | Used | Reset | Progress |\n');
      md.appendMarkdown('|:---|:---:|:---:|:---:|:---:|\n');

      for (const m of modelsToTrack) {
        let totalUsed = 0;
        let totalMax = 0;
        let totalRemaining = 0;
        let hasUnlimited = false;
        let earliestReset: string | undefined;

        for (const t of targets) {
          const q = t.usage?.quotas?.[m];
          if (q) {
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

        const usedPct =
          hasUnlimited || totalMax <= 0
            ? 0
            : Math.min(100, Math.max(0, (totalUsed / totalMax) * 100));
        const remPct =
          hasUnlimited
            ? 100
            : totalMax <= 0
              ? 0
              : Math.min(100, Math.max(0, (totalRemaining / totalMax) * 100));
        const remStr = hasUnlimited ? '∞' : formatCompact(totalRemaining);
        const maxStr = hasUnlimited ? '∞' : formatCompact(totalMax);
        const pctStr = hasUnlimited ? 'N/A' : `${usedPct.toFixed(1)}%`;
        const healthIcon = hasUnlimited ? '🟢' : getHealthIcon(remPct);
        const barStr = hasUnlimited
          ? '—'
          : `${healthIcon} ${renderTextBar(usedPct, 8)}`;
        const resetCol = formatResetCompact(earliestReset) || '—';

        md.appendMarkdown(
          `| **${quotaTitle(m)}** | ${remStr} / ${maxStr} | ${pctStr} | ${resetCol} | ${barStr} |\n`
        );
      }
      md.appendMarkdown('\n');
    }

    // Account Details
    if (showAccounts) {
      md.appendMarkdown('**Account Details**\n\n');
      const modelHeaders = modelsToTrack.map((m) => quotaTitle(m));
      const headerCols = ['#', 'Account', ...modelHeaders, 'Status'];
      const alignCols = [
        ':--',
        ':---',
        ...modelsToTrack.map(() => ':---:'),
        ':---:'
      ];
      md.appendMarkdown(`| ${headerCols.join(' | ')} |\n`);
      md.appendMarkdown(`| ${alignCols.join(' | ')} |\n`);

      for (const t of targets) {
        const conn = t.connection;
        const isPinnedAcc = pinnedAccountIds.includes(conn.id);
        const accNum = `${isPinnedAcc ? '⭐' : ''}#${conn.priority}`;
        const accName = truncateName(displayName(conn), 12);
        const statusIcon = conn.isActive ? '✓ Active' : '✗ Inactive';

        const modelCols = modelsToTrack.map((m) => {
          const q = t.usage?.quotas?.[m];
          if (!q) {
            return '-';
          }
          if (q.unlimited) {
            return '**∞** / ∞';
          }
          const rem = formatCompact(q.remaining);
          const tot = formatCompact(q.total);
          const pct = Math.round(getUsedPercent(q));
          return `**${rem}** / ${tot} (${pct}%)`;
        });

        md.appendMarkdown(
          `| ${accNum} | ${accName} | ${modelCols.join(' | ')} | ${statusIcon} |\n`
        );
      }
      md.appendMarkdown('\n');
    }
  } else {
    // targets.length === 1
    const target = targets[0];
    const conn = target.connection;
    const isPinnedAcc = pinnedAccountIds.includes(conn.id);
    const nameLabel = displayName(conn);
    const plan = target.usage?.plan ?? connectionPlan(conn) ?? 'Standard';
    const statusText = conn.isActive ? '✓ Active' : '✗ Inactive';

    md.appendMarkdown(
      `**${isPinnedAcc ? '⭐ ' : ''}${nameLabel}** (\`#${conn.priority}\`) · \`${conn.provider}\` · \`${statusText}\` · \`${plan}\`\n\n`
    );

    const quotas = target.usage?.quotas ?? {};
    let singleModels = pinnedModels.filter((m) => quotas[m] !== undefined);
    if (singleModels.length === 0) {
      const activeEntries = Object.entries(quotas)
        .filter(([, q]) => q.used > 0)
        .sort((a, b) => b[1].used - a[1].used)
        .map(([k]) => k);
      singleModels =
        activeEntries.length > 0
          ? activeEntries.slice(0, 5)
          : Object.keys(quotas).slice(0, 3);
    }

    if (singleModels.length > 0) {
      md.appendMarkdown('| Model | Remaining / Total | Used | Reset | Progress |\n');
      md.appendMarkdown('|:---|:---:|:---:|:---:|:---:|\n');

      for (const m of singleModels) {
        const q = quotas[m];
        const isPinnedModel = pinnedModels.includes(m);
        const usedPct = getUsedPercent(q);
        const remPct = getRemainingPercent(q);
        const rem = q.unlimited ? '∞' : formatCompact(q.remaining);
        const tot = q.unlimited ? '∞' : formatCompact(q.total);
        const pctStr = q.unlimited ? 'N/A' : `${usedPct.toFixed(1)}%`;
        const healthIcon = q.unlimited ? '🟢' : getHealthIcon(remPct);
        const barStr = q.unlimited
          ? '—'
          : `${healthIcon} ${renderTextBar(usedPct, 8)}`;
        const modelTitle = `${isPinnedModel ? '⭐ ' : ''}${quotaTitle(m)}`;
        const resetCol = formatResetCompact(q.resetAt) || '—';

        md.appendMarkdown(
          `| ${modelTitle} | **${rem}** / ${tot} | ${pctStr} | ${resetCol} | ${barStr} |\n`
        );
      }
      md.appendMarkdown('\n');
    } else {
      md.appendMarkdown('*No quota information available.*\n\n');
    }
  }

  const currentMode = cfg.tooltipDisplayMode ?? 'all';
  const toggleLabel =
    currentMode === 'summary'
      ? 'Toggle: Show All Details'
      : 'Toggle: Summary Only';

  md.appendMarkdown(
    `---\n\n👉 [Open Quick Menu](command:aiTokenUsage.openQuickMenu) &nbsp;│&nbsp; [Open Dashboard Webview](command:aiTokenUsage.showDetails) &nbsp;│&nbsp; [${toggleLabel}](command:aiTokenUsage.toggleTooltipMode)\n`
  );

  return md;
}

function formatLogTime(ts?: string): string {
  if (!ts) {
    return '—';
  }
  if (ts.includes('T')) {
    const t = ts.split('T')[1];
    return t ? t.slice(0, 8) : ts;
  }
  if (ts.includes(' ')) {
    const parts = ts.split(' ');
    return parts[1] ? parts[1].slice(0, 8) : parts[0];
  }
  return ts.length > 10 ? ts.slice(-8) : ts;
}

export function createLogStatusBarTooltip(
  stats?: UsageStats,
  recentLogs?: RequestLogItem[],
  limit = 10,
  tooltipMode: 'all' | 'summary' | 'logs' = 'all'
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = {
    enabledCommands: [
      'aiTokenUsage.openConsoleLog',
      'aiTokenUsage.openUsageAnalytics',
      'aiTokenUsage.setLogTooltipLimit',
      'aiTokenUsage.toggleLogTooltipMode',
      'aiTokenUsage.setLogTooltipMode',
      'aiTokenUsage.setLogStatusDisplayMode',
      'aiTokenUsage.refresh'
    ]
  };
  md.supportHtml = true;

  md.appendMarkdown('### 🖥️ 9Router Monitor Pro · Live System & Usage\n\n');

  if (tooltipMode !== 'logs') {
    if (stats) {
      md.appendMarkdown(
        '| 🔢 Requests | 📥 Input | ⚡ Cached | 📤 Output | 💵 Est. Cost |\n'
      );
      md.appendMarkdown('| :---: | :---: | :---: | :---: | :---: |\n');
      const reqStr = (stats.totalRequests ?? 0).toLocaleString();
      const promptStr = formatCompact(stats.totalPromptTokens ?? 0);
      const cachedStr = formatCompact(stats.totalCachedTokens ?? 0);
      const compStr = formatCompact(stats.totalCompletionTokens ?? 0);
      const costStr = `$${Number(stats.totalCost ?? 0).toFixed(2)}`;
      md.appendMarkdown(
        `| **${reqStr}** | **${promptStr}** | **${cachedStr}** | **${compStr}** | **${costStr}** |\n\n`
      );
    } else {
      md.appendMarkdown('_Fetching usage metrics..._\n\n');
    }
  }

  if (tooltipMode === 'all') {
    md.appendMarkdown('---\n\n');
  }

  if (tooltipMode !== 'summary') {
    const totalCount = recentLogs?.length ?? 0;
    const effectiveLimit = Math.max(1, Math.min(50, limit));
    const displayItems = (recentLogs ?? []).slice(0, effectiveLimit);
    const displayCount = displayItems.length;

    const opt10 =
      effectiveLimit === 10
        ? '**[10](command:aiTokenUsage.setLogTooltipLimit?%2210%22)**'
        : '[10](command:aiTokenUsage.setLogTooltipLimit?%2210%22)';
    const opt25 =
      effectiveLimit === 25
        ? '**[25](command:aiTokenUsage.setLogTooltipLimit?%2225%22)**'
        : '[25](command:aiTokenUsage.setLogTooltipLimit?%2225%22)';
    const opt50 =
      effectiveLimit === 50
        ? '**[50](command:aiTokenUsage.setLogTooltipLimit?%2250%22)**'
        : '[50](command:aiTokenUsage.setLogTooltipLimit?%2250%22)';

    md.appendMarkdown(
      `#### 🕒 Recent Transactions (${displayCount} of ${totalCount}, max 50)\n\n`
    );
    md.appendMarkdown(`Show: ${opt10} &nbsp;│&nbsp; ${opt25} &nbsp;│&nbsp; ${opt50}\n\n`);

    if (displayItems.length === 0) {
      md.appendMarkdown('_No recent transactions found._\n\n');
    } else {
      md.appendMarkdown('| Time | Model | Provider | In / Out | Status | Account |\n');
      md.appendMarkdown('| :--- | :--- | :--- | :---: | :---: | :--- |\n');
      for (const item of displayItems) {
        const timeStr = formatLogTime(item.timestamp);
        const modelStr = truncateName(item.model || '—', 16);
        const providerStr = truncateName(item.provider || '—', 10);
        const inOutStr = `${formatCompact(item.inTokens ?? 0)} / ${formatCompact(
          item.outTokens ?? 0
        )}`;
        const isOk =
          (item.status || '').toLowerCase() === 'ok' ||
          item.status === '200' ||
          item.status === 'success';
        const statusBadge = isOk ? '🟢 OK' : '🔴 FAIL';
        const accountStr = truncateName(item.account || 'default', 12);

        md.appendMarkdown(
          `| ${timeStr} | ${modelStr} | ${providerStr} | ${inOutStr} | ${statusBadge} | &nbsp;${accountStr} |\n`
        );
      }
      md.appendMarkdown('\n');
    }
  }

  const modeLabel =
    tooltipMode === 'all'
      ? 'All'
      : tooltipMode === 'summary'
        ? 'Summary'
        : 'Logs';

  md.appendMarkdown(
    `---\n\n[⚙️ Mode: ${modeLabel}](command:aiTokenUsage.toggleLogTooltipMode) &nbsp;│&nbsp; [🖥️ Live Console Log](command:aiTokenUsage.openConsoleLog) &nbsp;│&nbsp; [📈 Usage Analytics](command:aiTokenUsage.openUsageAnalytics) &nbsp;│&nbsp; [🔄 Refresh](command:aiTokenUsage.refresh)\n`
  );

  return md;
}
