import * as vscode from 'vscode';
import { ExtensionConfig, AuthContext } from './types';
import {
  SECRET_PASSWORD,
  SECRET_SESSION_TOKEN,
  SECRET_API_KEY,
  getLocalCliToken,
  loginDashboard
} from './services/authManager';
import {
  setCurrentContext,
  setLastDashboard,
  setLastError,
  getLastDashboard
} from './services/stateManager';
import { fetchDashboard } from './services/apiClient';
import { initStatusBar, renderStatusBar } from './ui/statusBar';
import {
  openQuickMenu,
  setConnection,
  setRefreshInterval,
  setDisplayMode,
  setApiKey
} from './ui/quickMenu';
import { showDetails, syncDashboardWebview } from './ui/dashboardPanel';

let refreshTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  setCurrentContext(context);
  initStatusBar(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('aiTokenUsage.openQuickMenu', () =>
      openQuickMenu(
        context,
        getConfig(),
        () => refresh(context),
        () => showDetails(context, getConfig(), () => refresh(context))
      )
    ),
    vscode.commands.registerCommand('aiTokenUsage.refresh', () =>
      refresh(context)
    ),
    vscode.commands.registerCommand('aiTokenUsage.setApiKey', () =>
      setApiKey(context, () => refresh(context))
    ),
    vscode.commands.registerCommand('aiTokenUsage.setConnection', () =>
      setConnection(context, () => refresh(context))
    ),
    vscode.commands.registerCommand('aiTokenUsage.showDetails', () =>
      showDetails(context, getConfig(), () => refresh(context))
    ),
    vscode.commands.registerCommand('aiTokenUsage.setInterval', () =>
      setRefreshInterval(getConfig())
    ),
    vscode.commands.registerCommand('aiTokenUsage.setDisplayMode', () =>
      setDisplayMode(getConfig(), () => refresh(context))
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiTokenUsage.refreshIntervalSeconds')) {
        scheduleRefresh(context);
      }
      if (e.affectsConfiguration('aiTokenUsage')) {
        void refresh(context);
      }
    })
  );

  renderStatusBar(getConfig());
  void refresh(context);
  scheduleRefresh(context);
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}

export function getConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('aiTokenUsage');
  return {
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
    intervalSeconds: Math.max(
      10,
      cfg.get<number>('refreshIntervalSeconds', 60)
    )
  };
}

export function scheduleRefresh(context: vscode.ExtensionContext): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  const { intervalSeconds } = getConfig();
  refreshTimer = setInterval(() => {
    void refresh(context);
  }, intervalSeconds * 1000);
}

export async function refresh(context: vscode.ExtensionContext): Promise<void> {
  setCurrentContext(context);
  const config = getConfig();
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
