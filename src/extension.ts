import * as vscode from 'vscode';
import { ExtensionConfig, AuthContext } from './types';
import {
  SECRET_PASSWORD,
  SECRET_SESSION_TOKEN,
  SECRET_API_KEY,
  getLocalCliToken,
  loginDashboard,
  getAuthContext
} from './services/authManager';
import {
  setCurrentContext,
  setLastDashboard,
  setLastError,
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
  toggleTooltipMode
} from './ui/quickMenu';
import { showDetails, syncDashboardWebview } from './ui/dashboardPanel';
import { getOutputChannel } from './utils/logger';

let refreshTimer: NodeJS.Timeout | undefined;
let logRefreshTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  setCurrentContext(context);
  initStatusBar(context);

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
      (limitStr?: string | number) => {
        const parsed =
          typeof limitStr === 'number'
            ? limitStr
            : parseInt(String(limitStr || ''), 10) || 10;
        setLogTooltipLimit(parsed);
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
      getOutputChannel().show();
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
        e.affectsConfiguration('aiTokenUsage.tooltipDisplayMode')
      ) {
        // Pure visual display change: re-render immediately without redundant network fetch
        const fresh = getConfig();
        renderStatusBar(fresh);
        syncDashboardWebview(context, fresh);
        return;
      }
      if (e.affectsConfiguration('aiTokenUsage')) {
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
  const active = getActiveConfig();
  const cfg = vscode.workspace.getConfiguration('aiTokenUsage');
  const fresh: ExtensionConfig = {
    baseUrl: cfg.get<string>('apiBaseUrl', 'http://localhost:20128'),
    providersPath: cfg.get<string>(
      'providersPath',
      '/api/providers?page=1&pageSize=20&accountStatus=all&sort=priority&isActive=true'
    ),
    usagePathTemplate: cfg.get<string>('usagePathTemplate', '/api/usage/{id}'),
    statusBarQuota: cfg.get<string>('statusBarQuota', 'session'),
    statusDisplayMode:
      active?.statusDisplayMode ??
      cfg.get<'compact' | 'detailed' | 'minimal'>(
        'statusDisplayMode',
        'compact'
      ),
    tooltipDisplayMode:
      active?.tooltipDisplayMode ??
      cfg.get<'all' | 'summary' | 'accounts'>('tooltipDisplayMode', 'all'),
    intervalSeconds: Math.max(
      5,
      cfg.get<number>('refreshIntervalSeconds', 60)
    ),
    logStatusBarRefreshIntervalSeconds: Math.max(
      3,
      cfg.get<number>('logStatusBarRefreshIntervalSeconds', 10)
    ),
    showLogStatusBar: cfg.get<boolean>('showLogStatusBar', true)
  };
  setActiveConfig(fresh);
  return fresh;
}

export async function refreshLogStatusBar(context: vscode.ExtensionContext): Promise<void> {
  const config = getActiveConfig() ?? getConfig();
  if (config.showLogStatusBar === false) return;
  try {
    const auth = await getAuthContext(context, config);
    if (auth) {
      const [stats, logs] = await Promise.all([
        fetchUsageStats(config, auth),
        fetchRequestLogs(config, auth, 1, 50)
      ]);
      if (stats) setLastUsageStats(stats);
      if (logs && logs.length > 0) setLastRecentLogs(logs);
      renderStatusBar(config);
    }
  } catch {
    // Non-blocking background log telemetry refresh
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
        await executeRefresh(context);
      }
    );
    const lastErr = getLastError();
    if (lastErr) {
      vscode.window.showErrorMessage(
        `[9Router Pro] Refresh failed: ${lastErr}`
      );
    } else {
      const dashboard = getLastDashboard();
      const count = dashboard?.items.length ?? 0;
      vscode.window.showInformationMessage(
        `[9Router Pro] Refreshed successfully (${count} active accounts).`
      );
    }
  } else {
    await executeRefresh(context);
  }
}

async function executeRefresh(context: vscode.ExtensionContext): Promise<void> {
  setCurrentContext(context);
  const config = getConfig();

  // Run log status bar refresh in parallel immediately
  void refreshLogStatusBar(context);

  const password = await context.secrets.get(SECRET_PASSWORD);
  let sessionToken = await context.secrets.get(SECRET_SESSION_TOKEN);
  const legacyApiKey = await context.secrets.get(SECRET_API_KEY);
  const localCliToken = getLocalCliToken() ?? undefined;

  if (!password && !sessionToken && !legacyApiKey && !localCliToken) {
    setLastDashboard(undefined);
    setLastError(undefined);
    renderStatusBar(config, true);
    return;
  }

  const auth: AuthContext = {
    authToken: sessionToken,
    password,
    cliToken: localCliToken,
    legacyApiKey,
    baseUrl: config.baseUrl,
    context
  };

  if (password && !auth.authToken) {
    try {
      auth.authToken = await loginDashboard(auth.baseUrl, password);
      await context.secrets.store(SECRET_SESSION_TOKEN, auth.authToken);
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      setLastDashboard(undefined);
      renderStatusBar(config);
      return;
    }
  }

  try {
    const dashboard = await fetchDashboard(config, auth);
    setLastDashboard(dashboard);
    setLastError(undefined);
  } catch (err) {
    setLastError(err instanceof Error ? err.message : String(err));
  }

  renderStatusBar(config);
  syncDashboardWebview(context, config);
}
