import * as vscode from 'vscode';
import { ExtensionConfig } from '../types';
import {
  getAuthContext,
  getLocalCliToken,
  SECRET_API_KEY,
  SECRET_PASSWORD,
  SECRET_SESSION_TOKEN
} from '../services/authManager';
import { updateProviderActive } from '../services/apiClient';
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
import { setApiKey, setConnection } from './quickMenu';

export function syncDashboardWebview(
  context: vscode.ExtensionContext,
  cfg: ExtensionConfig
): void {
  const panel = getDetailsPanel();
  const dashboard = getLastDashboard();
  if (panel && dashboard) {
    panel.webview.html = getWebviewContent(dashboard, context, cfg);
  }
}

export async function showDetails(
  context: vscode.ExtensionContext,
  cfg: ExtensionConfig,
  onRefresh: () => Promise<void>
): Promise<void> {
  const password = await context.secrets.get(SECRET_PASSWORD);
  const sessionToken = await context.secrets.get(SECRET_SESSION_TOKEN);
  const apiKey = await context.secrets.get(SECRET_API_KEY);
  const cliToken = getLocalCliToken();

  if (!password && !sessionToken && !apiKey && !cliToken) {
    const pick = await vscode.window.showWarningMessage(
      '9Router connection is not configured.',
      'Configure Now'
    );
    if (pick === 'Configure Now') {
      await setConnection(context, onRefresh);
    }
    return;
  }

  let dashboard = getLastDashboard();
  if (!dashboard) {
    await onRefresh();
    dashboard = getLastDashboard();
  }

  const lastErr = getLastError();
  if (lastErr && !dashboard) {
    const pick = await vscode.window.showErrorMessage(
      `9Router Monitor Pro: ${lastErr}`,
      'Retry',
      'Change Connection'
    );
    if (pick === 'Retry') {
      await onRefresh();
    } else if (pick === 'Change Connection') {
      await setConnection(context, onRefresh);
    }
    return;
  }

  if (!dashboard) {
    return;
  }

  let detailsPanel = getDetailsPanel();
  if (detailsPanel) {
    detailsPanel.webview.html = getWebviewContent(dashboard, context, cfg);
    detailsPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  detailsPanel = vscode.window.createWebviewPanel(
    'aiTokenUsage.dashboard',
    '9Router Monitor Pro',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  setDetailsPanel(detailsPanel);
  detailsPanel.webview.html = getWebviewContent(dashboard, context, cfg);

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
    }) => {
      if (msg.command === 'refresh') {
        await onRefresh();
        syncDashboardWebview(context, cfg);
      } else if (msg.command === 'setConnection') {
        await setConnection(context, onRefresh);
        syncDashboardWebview(context, cfg);
      } else if (msg.command === 'changeApiKey') {
        await setApiKey(context, onRefresh);
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
            'Unpinned account from Status Bar.'
          );
        } else {
          pinnedAccountIds = [...pinnedAccountIds, msg.accountId];
          const conn = getLastDashboard()?.items.find(
            (it) => it.connection.id === msg.accountId
          )?.connection;
          vscode.window.showInformationMessage(
            `Pinned ${
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
            'No authentication credentials found to connect to 9Router.'
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
            `Account ${name} is now ${msg.newActive ? 'Active' : 'Inactive'}.`
          );
          await onRefresh();
          syncDashboardWebview(context, cfg);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Failed to update account status: ${errMsg}`
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
            `Unpinned ${quotaTitle(modelKey)} from Status Bar.`
          );
        } else {
          pinnedModels = [...pinnedModels, modelKey];
          vscode.window.showInformationMessage(
            `Pinned ${quotaTitle(modelKey)} to Status Bar.`
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
          vscode.window.showInformationMessage(`Model ${msg.model} unhidden.`);
        } else {
          updated = [...hidden, msg.model];
          vscode.window.showInformationMessage(`Model ${msg.model} hidden.`);
        }
        await setHiddenModels(context, updated);
        syncDashboardWebview(context, cfg);
      } else if (msg.command === 'updateSort' && msg.sort) {
        await setPreferredSort(context, msg.sort);
      } else if (msg.command === 'updateFilter' && msg.filter) {
        await setPreferredFilter(context, msg.filter);
      }
    },
    undefined,
    context.subscriptions
  );

  detailsPanel.onDidDispose(
    () => {
      setDetailsPanel(undefined);
    },
    undefined,
    context.subscriptions
  );
}
