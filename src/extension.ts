import * as vscode from 'vscode';
import { ExtensionConfig } from './types';
import {
  getAuthContext,
  clearCliTokenCache
} from './services/authManager';
import {
  setCurrentContext,
  setLastDashboard,
  setLastError,
  setLastLogError,
  getLastDashboard,
  getLastError,
  getActiveConfig,
  setActiveConfig,
  getLastUsageStats,
  setLastUsageStats,
  getLastRecentLogs,
  setLastRecentLogs,
  getLogTooltipLimit,
  setLogTooltipLimit
} from './services/stateManager';
import { fetchDashboard, fetchRequestLogs, fetchUsageStats } from './services/apiClient';
import { initStatusBar, renderStatusBar } from './ui/statusBar';
import {
  openQuickMenu,
  setConnection,
  setRefreshInterval,
  setLogRefreshInterval,
  setDisplayMode,
  setTooltipMode,
  toggleTooltipMode,
  setLogStatusDisplayMode,
  setLogTooltipMode,
  toggleLogTooltipMode
} from './ui/quickMenu';
import { showDetails, syncDashboardWebview } from './ui/dashboardPanel';
import {
  initLogger,
  showOutputChannel,
  logInfo,
  logDebug,
  logWarn,
  logError
} from './utils/logger';

let refreshTimer: NodeJS.Timeout | undefined;
let logRefreshTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  setCurrentContext(context);
  initLogger(context);
  initStatusBar(context);

  const initialCfg = getConfig();
  logInfo(
    'Extension',
    `9Router Monitor Pro activated (BaseURL: ${initialCfg.baseUrl}, Interval: ${initialCfg.intervalSeconds}s, Log Interval: ${initialCfg.logStatusBarRefreshIntervalSeconds}s)`
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiTokenUsage.openQuickMenu', () =>
      openQuickMenu(
        context,
        getConfig(),
        (isManual?: boolean) => refresh(context, isManual),
        () =>
          showDetails(context, getConfig(), (isManual?: boolean) =>
            refresh(context, isManual)
          )
      )
    ),
    vscode.commands.registerCommand('aiTokenUsage.refresh', () =>
      refresh(context, true)
    ),
    vscode.commands.registerCommand('aiTokenUsage.setConnection', () =>
      setConnection(context, () => refresh(context))
    ),
    vscode.commands.registerCommand('aiTokenUsage.showDetails', () =>
      showDetails(context, getConfig(), (isManual?: boolean) =>
        refresh(context, isManual)
      )
    ),
    vscode.commands.registerCommand('aiTokenUsage.setInterval', () =>
      setRefreshInterval(getConfig())
    ),
    vscode.commands.registerCommand('aiTokenUsage.setLogRefreshInterval', () =>
      setLogRefreshInterval(getConfig())
    ),
    vscode.commands.registerCommand('aiTokenUsage.setDisplayMode', () =>
      setDisplayMode(getConfig(), () => refresh(context))
    ),
    vscode.commands.registerCommand('aiTokenUsage.setTooltipMode', () =>
      setTooltipMode(getConfig(), () => refresh(context))
    ),
    vscode.commands.registerCommand('aiTokenUsage.toggleTooltipMode', () =>
      toggleTooltipMode(getConfig(), () => refresh(context))
    ),
    vscode.commands.registerCommand('aiTokenUsage.toggleLogTooltipMode', () =>
      toggleLogTooltipMode(getActiveConfig() ?? getConfig(), () => refresh(context))
    ),
    vscode.commands.registerCommand('aiTokenUsage.setLogStatusDisplayMode', () =>
      setLogStatusDisplayMode(getActiveConfig() ?? getConfig(), () => refresh(context))
    ),
    vscode.commands.registerCommand('aiTokenUsage.setLogTooltipMode', () =>
      setLogTooltipMode(getActiveConfig() ?? getConfig(), () => refresh(context))
    ),
    vscode.commands.registerCommand('aiTokenUsage.openConsoleLog', () =>
      showDetails(
        context,
        getActiveConfig() ?? getConfig(),
        (isManual?: boolean) => refresh(context, isManual),
        'console'
      )
    ),
    vscode.commands.registerCommand('aiTokenUsage.openUsageAnalytics', () =>
      showDetails(
        context,
        getActiveConfig() ?? getConfig(),
        (isManual?: boolean) => refresh(context, isManual),
        'analytics'
      )
    ),
    vscode.commands.registerCommand(
      'aiTokenUsage.setLogTooltipLimit',
      async (limitStr?: string | number) => {
        const parsed =
          typeof limitStr === 'number'
            ? limitStr
            : parseInt(String(limitStr || ''), 10) || 10;
        await setLogTooltipLimit(parsed, context);
        renderStatusBar(getActiveConfig() ?? getConfig());
      }
    ),
    vscode.commands.registerCommand('aiTokenUsage.toggleLogStatusBar', async () => {
      const cfg = vscode.workspace.getConfiguration('aiTokenUsage');
      const current = cfg.get<boolean>('showLogStatusBar', true);
      await cfg.update('showLogStatusBar', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `9Router Console Log Status Bar item: ${!current ? 'Enabled' : 'Disabled'}`
      );
    }),
    vscode.commands.registerCommand('aiTokenUsage.showDebugLogs', () => {
      showOutputChannel();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiTokenUsage.refreshIntervalSeconds')) {
        scheduleRefresh(context);
      }
      if (e.affectsConfiguration('aiTokenUsage.logStatusBarRefreshIntervalSeconds')) {
        scheduleLogStatusBarRefresh(context);
      }
      if (
        e.affectsConfiguration('aiTokenUsage.statusDisplayMode') ||
        e.affectsConfiguration('aiTokenUsage.tooltipDisplayMode') ||
        e.affectsConfiguration('aiTokenUsage.logStatusDisplayMode') ||
        e.affectsConfiguration('aiTokenUsage.logTooltipDisplayMode') ||
        e.affectsConfiguration('aiTokenUsage.showLogStatusBar')
      ) {
        // Pure visual display change: re-render immediately without redundant network fetch
        const fresh = getConfig();
        renderStatusBar(fresh);
        syncDashboardWebview(context, fresh);
        return;
      }
      if (e.affectsConfiguration('aiTokenUsage')) {
        clearCliTokenCache();
        void refresh(context);
      }
    })
  );

  renderStatusBar(getConfig());
  void refresh(context);
  scheduleRefresh(context);
  scheduleLogStatusBarRefresh(context);
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  if (logRefreshTimer) {
    clearInterval(logRefreshTimer);
    logRefreshTimer = undefined;
  }
}

export function getConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('aiTokenUsage');
  const fresh: ExtensionConfig = {
    baseUrl: cfg.get<string>('apiBaseUrl', 'http://localhost:20128'),
    providersPath: cfg.get<string>(
      'providersPath',
      '/api/providers?page=1&pageSize=20&accountStatus=all&sort=priority&isActive=true'
    ),
    usagePathTemplate: cfg.get<string>('usagePathTemplate', '/api/usage/{id}'),
    statusBarQuota: cfg.get<string>('statusBarQuota', 'session'),
    statusDisplayMode: cfg.get<'compact' | 'detailed' | 'minimal'>(
      'statusDisplayMode',
      'compact'
    ),
    tooltipDisplayMode: cfg.get<'all' | 'summary' | 'accounts'>(
      'tooltipDisplayMode',
      'all'
    ),
    intervalSeconds: Math.max(
      5,
      cfg.get<number>('refreshIntervalSeconds', 60)
    ),
    logStatusBarRefreshIntervalSeconds: Math.max(
      3,
      cfg.get<number>('logStatusBarRefreshIntervalSeconds', 10)
    ),
    showLogStatusBar: cfg.get<boolean>('showLogStatusBar', true),
    logTooltipDisplayMode: cfg.get<'all' | 'summary' | 'logs'>(
      'logTooltipDisplayMode',
      'all'
    ),
    logStatusDisplayMode: cfg.get<'minimal' | 'compact' | 'detailed'>(
      'logStatusDisplayMode',
      'minimal'
    )
  };
  setActiveConfig(fresh);
  return fresh;
}


export async function refreshLogStatusBar(context: vscode.ExtensionContext): Promise<void> {
  const config = getActiveConfig() ?? getConfig();
  if (config.showLogStatusBar === false) return;
  try {
    const auth = await getAuthContext(context, config);
    if (!auth) {
      setLastLogError('No credentials available');
      renderStatusBar(config);
      return;
    }
    const [stats, logs] = await Promise.all([
      fetchUsageStats(config, auth),
      fetchRequestLogs(config, auth, 1, 50)
    ]);
    if (stats) setLastUsageStats(stats);
    if (logs && logs.length > 0) setLastRecentLogs(logs);
    // Ghi nhận lỗi khi cả hai nguồn đều không trả dữ liệu; xóa lỗi khi thành công
    setLastLogError(
      !stats && (!logs || logs.length === 0)
        ? `No data returned from ${config.baseUrl} (check credentials/server)`
        : undefined
    );
    renderStatusBar(config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logWarn('Extension', `Log status bar refresh failed: ${msg}`);
    setLastLogError(msg);
    renderStatusBar(config);
  }
}

export function scheduleLogStatusBarRefresh(context: vscode.ExtensionContext): void {
  if (logRefreshTimer) {
    clearInterval(logRefreshTimer);
    logRefreshTimer = undefined;
  }
  const config = getConfig();
  const sec = config.logStatusBarRefreshIntervalSeconds || 10;
  logRefreshTimer = setInterval(() => {
    void refreshLogStatusBar(context);
  }, sec * 1000);
}

export function scheduleRefresh(context: vscode.ExtensionContext): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  const { intervalSeconds } = getConfig();
  refreshTimer = setInterval(() => {
    void refresh(context, false);
  }, intervalSeconds * 1000);
}

export async function refresh(
  context: vscode.ExtensionContext,
  isManual = false
): Promise<void> {
  if (isManual) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '9Router: Fetching latest quota data...',
        cancellable: false
      },
      async () => {
        await executeRefresh(context, true);
      }
    );
    const lastErr = getLastError();
    if (lastErr) {
      const pick = await vscode.window.showErrorMessage(
        `[9Router Pro] Refresh failed: ${lastErr}`,
        'View Logs',
        'Retry'
      );
      if (pick === 'View Logs') {
        showOutputChannel();
      } else if (pick === 'Retry') {
        void refresh(context, true);
      }
    } else {
      const dashboard = getLastDashboard();
      const count = dashboard?.items.length ?? 0;
      vscode.window.showInformationMessage(
        `[9Router Pro] Refreshed successfully (${count} active accounts).`
      );
    }
  } else {
    await executeRefresh(context, false);
  }
}

async function executeRefresh(
  context: vscode.ExtensionContext,
  isManual = false
): Promise<void> {
  if (isManual) {
    clearCliTokenCache();
  }
  setCurrentContext(context);
  const config = getConfig();

  // Run log status bar refresh in parallel immediately
  void refreshLogStatusBar(context);

  const auth = await getAuthContext(context, config);

  if (!auth) {
    setLastDashboard(undefined);
    setLastError(undefined);
    renderStatusBar(config, true);
    return;
  }

  if (auth.password && !auth.authToken) {
    const msg = `Login failed for ${config.baseUrl}`;
    logError('Extension', msg);
    setLastError(msg);
    setLastDashboard(undefined);
    renderStatusBar(config);
    return;
  }

  try {
    const dashboard = await fetchDashboard(config, auth);
    setLastDashboard(dashboard);
    setLastError(undefined);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('Extension', `Failed to fetch dashboard data from ${config.baseUrl}: ${msg}`, err);
    setLastError(msg);
  }

  renderStatusBar(config);
  syncDashboardWebview(context, config);
}
