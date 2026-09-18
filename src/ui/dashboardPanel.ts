import * as vscode from 'vscode';
import { ExtensionConfig } from '../types';
import {
  getAuthContext,
  getLocalCliToken,
  SECRET_API_KEY,
  SECRET_PASSWORD,
  SECRET_SESSION_TOKEN
} from '../services/authManager';
import {
  clearServerConsoleLogs,
  fetchRequestLogs,
  fetchUsageStats,
  openConsoleLogStream,
  updateProviderActive
} from '../services/apiClient';
import {
  getDetailsPanel,
  getHiddenModels,
  getLastDashboard,
  getLastError,
  getPinnedAccountIds,
  getPinnedModels,
  setDetailsPanel,
  setHiddenModels,
  setPinnedAccountIds,
  setPinnedModels,
  setPreferredFilter,
  setPreferredSort
} from '../services/stateManager';
import { displayName, quotaTitle } from '../utils/helpers';
import { getWebviewContent } from '../views/dashboardTemplate';
import { renderStatusBar } from './statusBar';
import { setConnection } from './quickMenu';
import { logDebug, logError } from '../utils/logger';

let activeLogStreamAbort: (() => void) | undefined;
let isStartingConsoleStream = false;

export function syncDashboardWebview(
  context: vscode.ExtensionContext,
  cfg: ExtensionConfig
): void {
  const panel = getDetailsPanel();
  const dashboard = getLastDashboard();
  if (!panel || !dashboard) {
    return;
  }
  try {
    const postPromise = panel.webview.postMessage({
      command: 'syncData',
      data: dashboard
    });
    if (postPromise && typeof postPromise.then === 'function') {
      postPromise.then((delivered) => {
        if (!delivered && panel && dashboard) {
          panel.webview.html = getWebviewContent(dashboard, context, cfg);
        }
      });
    }
  } catch {
    panel.webview.html = getWebviewContent(dashboard, context, cfg);
  }
}

export async function showDetails(
  context: vscode.ExtensionContext,
  cfg: ExtensionConfig,
  onRefresh: (isManual?: boolean) => Promise<void> | void,
  initialTab?: 'providers' | 'analytics' | 'console'
): Promise<void> {
  const password = await context.secrets.get(SECRET_PASSWORD);
  const sessionToken = await context.secrets.get(SECRET_SESSION_TOKEN);
  const apiKey = await context.secrets.get(SECRET_API_KEY);
  const cliToken = getLocalCliToken();

  if (!password && !sessionToken && !apiKey && !cliToken) {
    const pick = await vscode.window.showWarningMessage(
      '[9Router Pro] Connection is not configured.',
      'Configure Now'
    );
    if (pick === 'Configure Now') {
      await setConnection(context, () => Promise.resolve(onRefresh(true)));
    }
    return;
  }

  let dashboard = getLastDashboard();
  if (!dashboard) {
    await onRefresh(true);
    dashboard = getLastDashboard();
  }

  const lastErr = getLastError();
  if (lastErr && !dashboard) {
    const pick = await vscode.window.showErrorMessage(
      `[9Router Pro] Connection Error: ${lastErr}`,
      'Retry',
      'Change Connection'
    );
    if (pick === 'Retry') {
      await onRefresh(true);
    } else if (pick === 'Change Connection') {
      await setConnection(context, () => Promise.resolve(onRefresh(true)));
    }
    return;
  }

  if (!dashboard) {
    return;
  }

  let detailsPanel = getDetailsPanel();
  if (detailsPanel) {
    detailsPanel.reveal(vscode.ViewColumn.Beside);
    if (initialTab) {
      detailsPanel.webview.postMessage({ command: 'switchTab', tab: initialTab });
    }
    return;
  }

  detailsPanel = vscode.window.createWebviewPanel(
    'aiTokenUsage.dashboard',
    '9Router Monitor Pro',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  setDetailsPanel(detailsPanel);
  detailsPanel.webview.html = getWebviewContent(
    dashboard,
    context,
    cfg,
    undefined,
    undefined,
    initialTab
  );

  detailsPanel.webview.onDidReceiveMessage(
    async (msg: {
      command: string;
      model?: string;
      modelName?: string;
      sort?: string;
      filter?: string;
      accountId?: string;
      connectionId?: string;
      newActive?: boolean;
      statusMode?: 'compact' | 'detailed' | 'minimal';
      tooltipMode?: 'all' | 'summary' | 'accounts';
      intervalSeconds?: number;
      intervalMs?: number;
      initialLimit?: number;
      limit?: number;
      page?: number;
    }) => {
      if (msg.command === 'refresh') {
        await onRefresh(true);
        syncDashboardWebview(context, cfg);
      } else if (msg.command === 'setConnection') {
        await setConnection(context, () => Promise.resolve(onRefresh(true)));
        syncDashboardWebview(context, cfg);
      } else if (
        (msg.command === 'togglePinAccount' || msg.command === 'pinAccount') &&
        msg.accountId
      ) {
        let pinnedAccountIds = getPinnedAccountIds(context);
        if (pinnedAccountIds.includes(msg.accountId)) {
          pinnedAccountIds = pinnedAccountIds.filter(
            (id) => id !== msg.accountId
          );
          vscode.window.showInformationMessage(
            '[9Router Pro] Unpinned account from Status Bar.'
          );
        } else {
          pinnedAccountIds = [...pinnedAccountIds, msg.accountId];
          const conn = getLastDashboard()?.items.find(
            (it) => it.connection.id === msg.accountId
          )?.connection;
          vscode.window.showInformationMessage(
            `[9Router Pro] Pinned ${
              conn ? displayName(conn) : msg.accountId
            } to Status Bar.`
          );
        }
        await setPinnedAccountIds(context, pinnedAccountIds);
        renderStatusBar(cfg);
        syncDashboardWebview(context, cfg);
      } else if (
        msg.command === 'toggleProviderActive' &&
        msg.connectionId !== undefined
      ) {
        const auth = await getAuthContext(context, cfg.baseUrl);
        if (!auth) {
          vscode.window.showErrorMessage(
            '[9Router Pro] No authentication credentials found to connect to 9Router.'
          );
          return;
        }
        try {
          await updateProviderActive(
            auth,
            msg.connectionId,
            Boolean(msg.newActive)
          );
          const conn = getLastDashboard()?.items.find(
            (it) => it.connection.id === msg.connectionId
          )?.connection;
          const name = conn ? displayName(conn) : msg.connectionId;
          vscode.window.showInformationMessage(
            `[9Router Pro] Account ${name} is now ${msg.newActive ? 'Active' : 'Inactive'}.`
          );
          await onRefresh(true);
          syncDashboardWebview(context, cfg);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `[9Router Pro] Failed to update account status: ${errMsg}`
          );
        }
      } else if (
        (msg.command === 'togglePinModel' || msg.command === 'pinModel') &&
        (msg.modelName || msg.model)
      ) {
        const modelKey = msg.modelName || msg.model!;
        let pinnedModels = getPinnedModels(context);
        if (pinnedModels.includes(modelKey)) {
          pinnedModels = pinnedModels.filter((m) => m !== modelKey);
          vscode.window.showInformationMessage(
            `[9Router Pro] Unpinned ${quotaTitle(modelKey)} from Status Bar.`
          );
        } else {
          pinnedModels = [...pinnedModels, modelKey];
          vscode.window.showInformationMessage(
            `[9Router Pro] Pinned ${quotaTitle(modelKey)} to Status Bar.`
          );
        }
        await setPinnedModels(context, pinnedModels);
        renderStatusBar(cfg);
        syncDashboardWebview(context, cfg);
      } else if (msg.command === 'toggleHide' && msg.model) {
        const hidden = getHiddenModels(context);
        let updated: string[];
        if (hidden.includes(msg.model)) {
          updated = hidden.filter((m) => m !== msg.model);
          vscode.window.showInformationMessage(
            `[9Router Pro] Model ${msg.model} unhidden.`
          );
        } else {
          updated = [...hidden, msg.model];
          vscode.window.showInformationMessage(
            `[9Router Pro] Model ${msg.model} hidden.`
          );
        }
        await setHiddenModels(context, updated);
        syncDashboardWebview(context, cfg);
      } else if (msg.command === 'updateSort' && msg.sort) {
        await setPreferredSort(context, msg.sort);
      } else if (msg.command === 'updateFilter' && msg.filter) {
        await setPreferredFilter(context, msg.filter);
      } else if (msg.command === 'updateStatusStyle' && msg.statusMode) {
        const config = vscode.workspace.getConfiguration('aiTokenUsage');
        await config.update(
          'statusDisplayMode',
          msg.statusMode,
          vscode.ConfigurationTarget.Global
        );
        cfg.statusDisplayMode = msg.statusMode;
        renderStatusBar(cfg);
        vscode.window.showInformationMessage(
          `[9Router Pro] Status Bar display style set to: ${msg.statusMode}`
        );
      } else if (msg.command === 'updateTooltipStyle' && msg.tooltipMode) {
        const config = vscode.workspace.getConfiguration('aiTokenUsage');
        await config.update(
          'tooltipDisplayMode',
          msg.tooltipMode,
          vscode.ConfigurationTarget.Global
        );
        cfg.tooltipDisplayMode = msg.tooltipMode;
        renderStatusBar(cfg);
        vscode.window.showInformationMessage(
          `[9Router Pro] Tooltip detail level set to: ${msg.tooltipMode}`
        );
      } else if (
        msg.command === 'updateRefreshInterval' &&
        msg.intervalSeconds
      ) {
        const config = vscode.workspace.getConfiguration('aiTokenUsage');
        await config.update(
          'refreshIntervalSeconds',
          msg.intervalSeconds,
          vscode.ConfigurationTarget.Global
        );
        cfg.intervalSeconds = msg.intervalSeconds;
        vscode.window.showInformationMessage(
          `[9Router Pro] Auto-refresh interval set to ${msg.intervalSeconds}s.`
        );
      } else if (msg.command === 'startConsoleStream') {
        if (isStartingConsoleStream) {
          return;
        }
        isStartingConsoleStream = true;
        try {
          if (activeLogStreamAbort) {
            activeLogStreamAbort();
            activeLogStreamAbort = undefined;
          }
          logDebug('Dashboard', 'Received startConsoleStream message');
          const auth = await getAuthContext(context, cfg);
          if (!auth) {
            logError('Dashboard', 'No auth context available');
            detailsPanel?.webview.postMessage({
              command: 'consoleLogError',
              error:
                'Không tìm thấy thông tin xác thực (mật khẩu hoặc CLI Token). Vui lòng bấm Setup Connection.'
            });
            return;
          }
          if (detailsPanel) {
            const intervalMs = typeof msg.intervalMs === 'number' ? msg.intervalMs : 2500;
            const initialLimit = typeof msg.initialLimit === 'number' ? msg.initialLimit : 500;
            activeLogStreamAbort = openConsoleLogStream(
              cfg,
              auth,
              (event) => {
                detailsPanel?.webview.postMessage({
                  command: 'consoleLogEvent',
                  event
                });
              },
              (err) => {
                logError('Dashboard', 'Console stream error: ' + err.message, err);
                detailsPanel?.webview.postMessage({
                  command: 'consoleLogError',
                  error: err.message
                });
              },
              (systemMsg) => {
                detailsPanel?.webview.postMessage({
                  command: 'consoleLogSystem',
                  message: systemMsg
                });
              },
              { pollIntervalMs: intervalMs, initialLimit }
            );
          }
        } finally {
          isStartingConsoleStream = false;
        }
      } else if (msg.command === 'updateConsoleInterval') {
        const intervalMs = typeof msg.intervalMs === 'number' ? msg.intervalMs : 2500;
        const initialLimit = typeof msg.initialLimit === 'number' ? msg.initialLimit : 500;
        if (activeLogStreamAbort) {
          activeLogStreamAbort();
          activeLogStreamAbort = undefined;
        }
        if (intervalMs > 0 && detailsPanel) {
          const auth = await getAuthContext(context, cfg);
          if (auth) {
            activeLogStreamAbort = openConsoleLogStream(
              cfg,
              auth,
              (event) => {
                detailsPanel?.webview.postMessage({
                  command: 'consoleLogEvent',
                  event
                });
              },
              (err) => {
                logError('Dashboard', 'Console stream error: ' + err.message, err);
                detailsPanel?.webview.postMessage({
                  command: 'consoleLogError',
                  error: err.message
                });
              },
              (systemMsg) => {
                detailsPanel?.webview.postMessage({
                  command: 'consoleLogSystem',
                  message: systemMsg
                });
              },
              { pollIntervalMs: intervalMs, initialLimit }
            );
          }
        }
      } else if (msg.command === 'stopConsoleStream') {
        if (activeLogStreamAbort) {
          activeLogStreamAbort();
          activeLogStreamAbort = undefined;
        }
      } else if (msg.command === 'clearConsoleLogs') {
        const auth = await getAuthContext(context, cfg);
        if (auth) {
          await clearServerConsoleLogs(cfg, auth);
        }
      } else if (msg.command === 'fetchAnalytics') {
        const auth = await getAuthContext(context, cfg);
        if (auth) {
          const page = typeof msg.page === 'number' ? msg.page : 1;
          const limit = typeof msg.limit === 'number' ? msg.limit : 50;
          const [stats, logs] = await Promise.all([
            fetchUsageStats(cfg, auth),
            fetchRequestLogs(cfg, auth, page, limit)
          ]);
          detailsPanel?.webview.postMessage({
            command: 'analyticsData',
            stats,
            logs
          });
        }
      }
    },
    undefined,
    context.subscriptions
  );

  detailsPanel.onDidDispose(
    () => {
      if (activeLogStreamAbort) {
        activeLogStreamAbort();
        activeLogStreamAbort = undefined;
      }
      setDetailsPanel(undefined);
      detailsPanel = undefined;
    },
    undefined,
    context.subscriptions
  );
}
