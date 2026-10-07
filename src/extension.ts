import * as vscode from 'vscode';
import { ExtensionConfig } from './types';
import {
  getAuthContext,
  clearCliTokenCache
} from './services/authManager';
import {
  initSharedCache,
  readSharedCache,
  writeSharedCache,
  isQuotaCacheFresh,
  isLogsCacheFresh,
  startCacheWatcher
} from './services/sharedCacheManager';
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
  setLogTooltipLimit,
  applySharedCacheSnapshot
} from './services/stateManager';
import { fetchDashboard, fetchRequestLogs, fetchUsageStats } from './services/apiClient';
import {
  initStatusBar,
  renderLogStatusBar,
  renderQuotaStatusBar,
  renderStatusBar
} from './ui/statusBar';
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
  toggleLogTooltipMode,
  testAllConnectionsAction
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
let isRefreshInFlight = false;
let isLogRefreshInFlight = false;
let extensionActivatedAt = 0;

export function activate(context: vscode.ExtensionContext): void {
  extensionActivatedAt = Date.now();
  setCurrentContext(context);
  initLogger(context);
  initSharedCache(context);
  initStatusBar(context);

  const initialCfg = getConfig();
  logInfo(
    'Extension',
    `9Router Monitor Pro activated (BaseURL: ${initialCfg.baseUrl}, Interval: ${initialCfg.intervalSeconds}s, Log Interval: ${initialCfg.logStatusBarRefreshIntervalSeconds}s)`
  );

  // Lắng nghe thay đổi từ các cửa sổ VS Code khác qua Shared File Watcher
  const cacheWatcher = startCacheWatcher((snapshot) => {
    applySharedCacheSnapshot(snapshot);
    const cfg = getConfig();
    renderStatusBar(cfg);
    syncDashboardWebview(context, cfg);
  });
  context.subscriptions.push(cacheWatcher);

  // Smart Eco Mode: Tự động đồng bộ và nạp dữ liệu khi người dùng focus lại cửa sổ
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        // Bỏ qua trong 3 giây đầu khi vừa activate để tránh bão request trùng lặp
        if (Date.now() - extensionActivatedAt < 3000) {
          return;
        }
        logDebug('Extension', 'Window gained focus. Syncing shared cache state...');
        const cache = readSharedCache();
        if (cache) {
          applySharedCacheSnapshot(cache);
          renderStatusBar(getConfig());
        }
        if (!isQuotaCacheFresh()) {
          void refresh(context, false);
        }
        if (!isLogsCacheFresh()) {
          void refreshLogStatusBar(context);
        }
      }
    })
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
    vscode.commands.registerCommand('aiTokenUsage.testAllConnections', () =>
      testAllConnectionsAction(context, getConfig(), (isManual?: boolean) =>
        refresh(context, isManual)
      )
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

  // Khởi tạo ngay trạng thái từ Shared Cache nếu các cửa sổ khác đã fetch sẵn
  const initialCache = readSharedCache();
  if (initialCache) {
    applySharedCacheSnapshot(initialCache);
  }

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

  if (isLogRefreshInFlight) {
    return;
  }
  isLogRefreshInFlight = true;

  try {
    // Smart Eco Mode: Nếu cửa sổ không focused và cache logs còn tươi, dùng cache ngay không gọi HTTP
    if (!vscode.window.state.focused && isLogsCacheFresh()) {
      const cache = readSharedCache();
      if (cache) {
        applySharedCacheSnapshot(cache);
        renderLogStatusBar(config);
        return;
      }
    }

    // Follower: Nếu cache logs còn tươi (< 7s), đọc từ Shared Cache thay vì bắn thêm HTTP
    if (isLogsCacheFresh()) {
      const cache = readSharedCache();
      if (cache && (cache.usageStats || (cache.recentLogs && cache.recentLogs.length > 0))) {
        applySharedCacheSnapshot(cache);
        renderLogStatusBar(config);
        return;
      }
    }

    const auth = await getAuthContext(context, config);
    if (!auth) {
      setLastLogError('No credentials available');
      renderLogStatusBar(config);
      return;
    }
    const [stats, logs] = await Promise.all([
      fetchUsageStats(config, auth),
      fetchRequestLogs(config, auth, 1, 50)
    ]);
    if (stats) setLastUsageStats(stats);
    if (logs && logs.length > 0) setLastRecentLogs(logs);

    const errText =
      !stats && (!logs || logs.length === 0)
        ? `No data returned from ${config.baseUrl} (check credentials/server)`
        : undefined;
    setLastLogError(errText);

    // Đồng bộ snapshot vào Shared Cache để các cửa sổ khác nhận được qua File Watcher
    writeSharedCache({
      usageStats: stats ?? getLastUsageStats(),
      recentLogs: logs && logs.length > 0 ? logs : getLastRecentLogs(),
      logsUpdatedAt: Date.now(),
      lastLogError: errText
    });

    renderLogStatusBar(config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logWarn('Extension', `Log status bar refresh failed: ${msg}`);
    setLastLogError(msg);
    renderLogStatusBar(config);
  } finally {
    isLogRefreshInFlight = false;
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
  if (isRefreshInFlight) {
    if (!isManual) {
      return; // Bỏ qua nếu lượt refresh tự động trước đó vẫn đang chạy
    }
  }
  isRefreshInFlight = true;

  try {
    if (isManual) {
      clearCliTokenCache();
    }
    setCurrentContext(context);
    const config = getConfig();

    // 1. Smart Eco Mode: Nếu cửa sổ không focused và cache còn tươi, không gửi request HTTP
    if (!isManual && !vscode.window.state.focused && isQuotaCacheFresh()) {
      const cache = readSharedCache();
      if (cache?.dashboard) {
        applySharedCacheSnapshot(cache);
        renderQuotaStatusBar(config);
        syncDashboardWebview(context, config);
        return;
      }
    }

    // 2. Follower: Nếu cache quota còn tươi (< 45s), nạp trực tiếp từ Shared Cache (0 HTTP calls)
    if (!isManual && isQuotaCacheFresh()) {
      const cache = readSharedCache();
      if (cache?.dashboard) {
        applySharedCacheSnapshot(cache);
        renderQuotaStatusBar(config);
        syncDashboardWebview(context, config);
        return;
      }
    }

    const auth = await getAuthContext(context, config);

    if (!auth) {
      setLastDashboard(undefined);
      setLastError(undefined);
      renderQuotaStatusBar(config, true);
      return;
    }

    if (auth.password && !auth.authToken) {
      const msg = `Login failed for ${config.baseUrl}`;
      logError('Extension', msg);
      setLastError(msg);
      setLastDashboard(undefined);
      renderQuotaStatusBar(config);
      return;
    }

    try {
      const dashboard = await fetchDashboard(config, auth);
      setLastDashboard(dashboard);
      setLastError(undefined);

      // Leader: ghi cache chung cho mọi cửa sổ VS Code khác
      writeSharedCache({
        dashboard,
        quotaUpdatedAt: Date.now(),
        lastError: undefined
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError('Extension', `Failed to fetch dashboard data from ${config.baseUrl}: ${msg}`, err);
      setLastError(msg);
      writeSharedCache({
        lastError: msg
      });
    }

    renderQuotaStatusBar(config);
    syncDashboardWebview(context, config);
  } finally {
    isRefreshInFlight = false;
  }
}
