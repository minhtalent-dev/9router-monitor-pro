import * as vscode from 'vscode';
import { ExtensionConfig } from '../types';
import {
  getLastDashboard,
  getPinnedAccountIds,
  getPinnedModels,
  setPinnedAccountIds,
  setPinnedModels
} from '../services/stateManager';
import {
  getAuthContext,
  getLocalCliToken,
  loginDashboard,
  SECRET_API_KEY,
  SECRET_PASSWORD,
  SECRET_SESSION_TOKEN
} from '../services/authManager';
import { updateProviderActive } from '../services/apiClient';
import { formatCompact } from '../utils/formatters';
import {
  connectionPlan,
  displayName,
  getUsedPercent,
  quotaTitle
} from '../utils/helpers';
import { renderStatusBar } from './statusBar';

interface IntervalPickItem extends vscode.QuickPickItem {
  seconds?: number;
  isCustom?: boolean;
}

export async function setConnection(
  context: vscode.ExtensionContext,
  onRefresh: () => Promise<void>
): Promise<void> {
  const currentBaseUrl = vscode.workspace
    .getConfiguration('aiTokenUsage')
    .get<string>('apiBaseUrl', 'http://localhost:20128');
  const existingPassword = await context.secrets.get(SECRET_PASSWORD);

  // Step 1: Input Base URL
  const inputUrl = await vscode.window.showInputBox({
    title: '9Router Monitor Pro — Connection Setup (Step 1/2)',
    prompt:
      'Enter 9Router Base URL (Local: http://localhost:20128 or Cloudflare Tunnel: https://...)',
    value: currentBaseUrl || 'http://localhost:20128',
    ignoreFocusOut: true,
    placeHolder: 'http://localhost:20128 or https://*.trycloudflare.com'
  });

  if (inputUrl === undefined) {
    return;
  }

  const cleanUrl =
    inputUrl.trim().replace(/\/+$/, '') || 'http://localhost:20128';

  // Step 2: Input Dashboard Password
  const inputPassword = await vscode.window.showInputBox({
    title: '9Router Monitor Pro — Dashboard Password (Step 2/2)',
    prompt:
      'Enter 9Router Dashboard Password. (Leave blank if running locally without password)',
    password: true,
    value: existingPassword ?? '',
    ignoreFocusOut: true,
    placeHolder: 'Dashboard password (default 123456 if unchanged)'
  });

  if (inputPassword === undefined) {
    return;
  }

  // Save Base URL to configuration
  const cfg = vscode.workspace.getConfiguration('aiTokenUsage');
  await cfg.update('apiBaseUrl', cleanUrl, vscode.ConfigurationTarget.Global);

  const trimmedPassword = inputPassword.trim();
  if (trimmedPassword !== '') {
    await context.secrets.store(SECRET_PASSWORD, trimmedPassword);
    try {
      const sessionToken = await loginDashboard(cleanUrl, trimmedPassword);
      await context.secrets.store(SECRET_SESSION_TOKEN, sessionToken);
      vscode.window.showInformationMessage(
        '[9Router Pro] Connected successfully to 9Router!'
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      vscode.window.showWarningMessage(
        `[9Router Pro] Saved Base URL, but authentication failed: ${errMsg} Please check password or Tunnel status.`
      );
    }
  } else {
    await context.secrets.delete(SECRET_PASSWORD);
    await context.secrets.delete(SECRET_SESSION_TOKEN);
    const cliToken = getLocalCliToken();
    if (cliToken) {
      vscode.window.showInformationMessage(
        '[9Router Pro] Saved Base URL and local mode.'
      );
    } else {
      vscode.window.showInformationMessage(
        '[9Router Pro] Dashboard password removed.'
      );
    }
  }

  await onRefresh();
}

export async function setApiKey(
  context: vscode.ExtensionContext,
  onRefresh: () => Promise<void>
): Promise<void> {
  const existing = await context.secrets.get(SECRET_API_KEY);
  const value = await vscode.window.showInputBox({
    title: '9Router Monitor Pro — API Key',
    prompt: 'Enter your 9Router API key. Leave blank to delete saved key.',
    password: true,
    value: existing ?? '',
    ignoreFocusOut: true,
    placeHolder: 'sk-...'
  });

  if (value === undefined) {
    return;
  }

  if (value.trim() === '') {
    await context.secrets.delete(SECRET_API_KEY);
    vscode.window.showInformationMessage('[9Router Pro] API key cleared.');
  } else {
    await context.secrets.store(SECRET_API_KEY, value.trim());
    vscode.window.showInformationMessage('[9Router Pro] API key saved.');
  }
  await onRefresh();
}

export async function setDisplayMode(
  cfg: ExtensionConfig,
  onRefresh: () => Promise<void>
): Promise<void> {
  const currentMode = cfg.statusDisplayMode ?? 'compact';

  interface DisplayModePickItem extends vscode.QuickPickItem {
    mode: 'compact' | 'detailed' | 'minimal';
  }

  const items: DisplayModePickItem[] = [
    {
      label: '$(symbol-color) Compact (Default)',
      description: 'Balanced: 10⭐ · G3.8 5.1K · Claude 1.2K',
      detail: 'Hides /total and reset time for a clean, condensed status bar',
      mode: 'compact',
      picked: currentMode === 'compact'
    },
    {
      label: '$(list-flat) Detailed',
      description: 'Full: ⭐ 10 acc · G3.8 5.1K/10K (23/09 09:53)',
      detail: 'Shows full remaining/total ratio and earliest reset timestamp',
      mode: 'detailed',
      picked: currentMode === 'detailed'
    },
    {
      label: '$(dash) Minimal',
      description: 'Ultra-compact: G3.8 5.1K · Claude 1.2K',
      detail: 'Omits account prefix entirely, saving maximum status bar space',
      mode: 'minimal',
      picked: currentMode === 'minimal'
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: `9Router Monitor Pro — Status Bar Display Style (Current: ${currentMode})`,
    placeHolder: 'Select status bar display style'
  });

  if (!selected) {
    return;
  }

  const config = vscode.workspace.getConfiguration('aiTokenUsage');
  await config.update(
    'statusDisplayMode',
    selected.mode,
    vscode.ConfigurationTarget.Global
  );
  vscode.window.showInformationMessage(
    `[9Router Pro] Status Bar display style set to: ${selected.mode}`
  );
  await onRefresh();
}

export async function setRefreshInterval(cfg: ExtensionConfig): Promise<void> {
  const currentInterval = cfg.intervalSeconds;

  const items: IntervalPickItem[] = [
    {
      label: '15 seconds',
      description: '15s - High frequency',
      seconds: 15,
      picked: currentInterval === 15
    },
    {
      label: '30 seconds',
      description: '30s',
      seconds: 30,
      picked: currentInterval === 30
    },
    {
      label: '60 seconds (Default)',
      description: '60s - Recommended',
      seconds: 60,
      picked: currentInterval === 60
    },
    {
      label: '2 minutes',
      description: '120s',
      seconds: 120,
      picked: currentInterval === 120
    },
    {
      label: '5 minutes',
      description: '300s',
      seconds: 300,
      picked: currentInterval === 300
    },
    {
      label: 'Custom...',
      description: 'Custom interval in seconds (>= 10s)',
      isCustom: true
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: `9Router Monitor Pro — Auto-Refresh Interval (Current: ${currentInterval}s)`,
    placeHolder: 'Select auto-refresh interval'
  });

  if (!selected) {
    return;
  }

  let seconds: number | undefined;

  if (selected.isCustom) {
    const input = await vscode.window.showInputBox({
      title: '9Router Monitor Pro — Custom Refresh Interval',
      prompt: 'Enter refresh interval in seconds (minimum 10 seconds)',
      value: String(currentInterval),
      validateInput: (val) => {
        const num = Number(val);
        if (!Number.isInteger(num) || num < 10) {
          return 'Value must be an integer >= 10 seconds.';
        }
        return null;
      }
    });

    if (input === undefined) {
      return;
    }

    seconds = parseInt(input.trim(), 10);
  } else {
    seconds = selected.seconds;
  }

  if (seconds !== undefined && !Number.isNaN(seconds)) {
    const config = vscode.workspace.getConfiguration('aiTokenUsage');
    await config.update(
      'refreshIntervalSeconds',
      seconds,
      vscode.ConfigurationTarget.Global
    );
    vscode.window.showInformationMessage(
      `[9Router Pro] Auto-refresh interval set to ${seconds} seconds.`
    );
  }
}

async function showPinAccountQuickPick(
  context: vscode.ExtensionContext,
  cfg: ExtensionConfig
): Promise<void> {
  const lastDashboard = getLastDashboard();
  if (!lastDashboard || lastDashboard.items.length === 0) {
    vscode.window.showWarningMessage('[9Router Pro] No accounts available.');
    return;
  }
  const pinnedAccountIds = getPinnedAccountIds(context);

  interface AccountPickItem extends vscode.QuickPickItem {
    accountId: string;
  }

  const pickItems: AccountPickItem[] = lastDashboard.items.map((item) => {
    const conn = item.connection;
    const isPinned = pinnedAccountIds.includes(conn.id);
    const isPrimary = conn.priority === 1;
    const statusIcon = conn.isActive ? '✓' : '✗';
    const plan = item.usage?.plan ?? connectionPlan(conn) ?? 'Standard';

    return {
      label: `${isPinned ? '$(star-full) ' : '$(star-empty) '}${displayName(
        conn
      )}`,
      description: `[${conn.provider}] #${conn.priority} · ${statusIcon} · ${plan}${
        isPrimary ? ' (Priority 1)' : ''
      }`,
      detail: `ID: ${conn.id}`,
      accountId: conn.id,
      picked: isPinned
    };
  });

  const selected = await vscode.window.showQuickPick(pickItems, {
    canPickMany: true,
    title: 'Select Accounts to Pin on Status Bar',
    placeHolder: 'Check accounts to pin on Status Bar',
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (selected === undefined) {
    return;
  }

  const newPinnedIds = selected.map((s) => s.accountId);
  await setPinnedAccountIds(context, newPinnedIds);

  renderStatusBar(cfg);
  vscode.window.showInformationMessage(
    `[9Router Pro] Updated ${selected.length} pinned account(s) on Status Bar.`
  );
}

async function showPinModelQuickPick(
  context: vscode.ExtensionContext,
  cfg: ExtensionConfig
): Promise<void> {
  const lastDashboard = getLastDashboard();
  if (!lastDashboard || lastDashboard.items.length === 0) {
    vscode.window.showWarningMessage('[9Router Pro] No accounts available.');
    return;
  }

  const pinnedModels = getPinnedModels(context);

  const modelKeysMap = new Map<
    string,
    { title: string; usageSummary?: string }
  >();
  for (const it of lastDashboard.items) {
    if (it.usage?.quotas) {
      for (const [key, quota] of Object.entries(it.usage.quotas)) {
        if (!modelKeysMap.has(key)) {
          const usedPct = getUsedPercent(quota);
          const rem = quota.unlimited ? '∞' : formatCompact(quota.remaining);
          const tot = quota.unlimited ? '∞' : formatCompact(quota.total);
          modelKeysMap.set(key, {
            title: quotaTitle(key),
            usageSummary: `${quota.used}/${tot} (${usedPct.toFixed(
              1
            )}%) · Rem: ${rem}`
          });
        }
      }
    }
  }

  if (modelKeysMap.size === 0) {
    vscode.window.showWarningMessage(
      '[9Router Pro] No models found across accounts.'
    );
    return;
  }

  interface ModelPickItem extends vscode.QuickPickItem {
    modelKey: string;
  }

  const pickItems: ModelPickItem[] = Array.from(modelKeysMap.entries()).map(
    ([key, info]) => {
      const isPinned = pinnedModels.includes(key);
      return {
        label: `${isPinned ? '$(star-full) ' : '$(star-empty) '}${info.title}`,
        description: `Key: ${key}${
          info.usageSummary ? ` · ${info.usageSummary}` : ''
        }`,
        modelKey: key,
        picked: isPinned
      };
    }
  );

  const selected = await vscode.window.showQuickPick(pickItems, {
    canPickMany: true,
    title: 'Select Models to Pin on Status Bar',
    placeHolder: 'Check models to pin on Status Bar',
    matchOnDescription: true
  });

  if (selected === undefined) {
    return;
  }

  const newPinnedModels = selected.map((s) => s.modelKey);
  await setPinnedModels(context, newPinnedModels);

  renderStatusBar(cfg);
  vscode.window.showInformationMessage(
    `[9Router Pro] Updated ${selected.length} pinned model(s) on Status Bar.`
  );
}

async function showToggleAccountQuickPick(
  context: vscode.ExtensionContext,
  onRefresh: () => Promise<void>
): Promise<void> {
  const lastDashboard = getLastDashboard();
  if (!lastDashboard || lastDashboard.items.length === 0) {
    vscode.window.showWarningMessage('[9Router Pro] No accounts available.');
    return;
  }

  interface TogglePickItem extends vscode.QuickPickItem {
    connectionId: string;
    currentActive: boolean;
    name: string;
  }

  const pickItems: TogglePickItem[] = lastDashboard.items.map((it) => {
    const conn = it.connection;
    const name = displayName(conn);
    return {
      label: `${conn.isActive ? '$(check) ' : '$(circle-slash) '}${name}`,
      description: `[${conn.provider}] #${conn.priority} — Status: ${
        conn.isActive ? 'Active' : 'Inactive'
      }`,
      detail: `Click to ${conn.isActive ? 'Disable' : 'Enable'} this account`,
      connectionId: conn.id,
      currentActive: conn.isActive,
      name
    };
  });

  const picked = await vscode.window.showQuickPick(pickItems, {
    title: 'Select an Account to Toggle Active / Inactive',
    placeHolder: 'Select an Account to Toggle Active / Inactive',
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (!picked) {
    return;
  }

  const auth = await getAuthContext(context);
  if (!auth) {
    vscode.window.showErrorMessage(
      '[9Router Pro] No authentication credentials found to connect to 9Router.'
    );
    return;
  }

  const newActive = !picked.currentActive;
  try {
    await updateProviderActive(auth, picked.connectionId, newActive);
    vscode.window.showInformationMessage(
      `[9Router Pro] Account ${picked.name} is now ${newActive ? 'Active' : 'Inactive'}.`
    );
    await onRefresh();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(
      `[9Router Pro] Failed to update account status: ${errMsg}`
    );
  }
}

export async function openQuickMenu(
  context: vscode.ExtensionContext,
  cfg: ExtensionConfig,
  onRefresh: (isManual?: boolean) => Promise<void>,
  onShowDetails: () => Promise<void>
): Promise<void> {
  if (!getLastDashboard()) {
    await onRefresh();
  }

  interface QuickMenuItem extends vscode.QuickPickItem {
    action: string;
  }

  const pinnedAccountIds = getPinnedAccountIds(context);
  const pinnedModels = getPinnedModels(context);

  const items: QuickMenuItem[] = [
    {
      label: '$(star) Pin / Unpin Accounts on Status Bar...',
      description: `Current: ${pinnedAccountIds.length} account(s) pinned`,
      detail:
        'Select one or multiple accounts to pin and aggregate on status bar',
      action: 'pinAccount'
    },
    {
      label: '$(symbol-event) Pin / Unpin Models on Status Bar...',
      description: `Current: ${pinnedModels.length} model(s) pinned`,
      detail: 'Select one or multiple models to pin on status bar',
      action: 'pinModel'
    },
    {
      label: '$(zap) Enable / Disable Accounts...',
      description: 'Active / Inactive',
      detail: 'Toggle provider account active status in 9Router',
      action: 'toggleAccount'
    },
    {
      label: '$(dashboard) Open Full Webview Dashboard',
      description: 'Full accounts & models overview',
      detail: 'View interactive matrix, multi-filter, search, and sort',
      action: 'openDashboard'
    },
    {
      label: '$(refresh) Refresh Data',
      description: 'Fetch latest quota from 9Router',
      detail: 'Fetch latest quota and provider stats immediately',
      action: 'refresh'
    },
    {
      label: `$(clock) Set Refresh Interval (${cfg.intervalSeconds}s)...`,
      description:
        'Configure auto-refresh frequency (15s, 30s, 60s, custom)',
      action: 'setInterval'
    },
    {
      label: `$(symbol-color) Status Bar Display Style (${cfg.statusDisplayMode ?? 'compact'})...`,
      description: 'Compact / Detailed / Minimal',
      detail:
        'Switch between compact (balanced), full detailed, or ultra-minimal display format',
      action: 'setDisplayMode'
    },
    {
      label: '$(gear) Setup Connection (URL & Password)',
      description: cfg.baseUrl,
      detail: 'Reconfigure Base URL, Password, or switch to Local CLI Token',
      action: 'setConnection'
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: '⭐ 9Router Monitor Pro — Quick Menu',
    placeHolder: 'Select a quick action or open Dashboard',
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (!selected) {
    return;
  }

  switch (selected.action) {
    case 'pinAccount':
      await showPinAccountQuickPick(context, cfg);
      break;
    case 'pinModel':
      await showPinModelQuickPick(context, cfg);
      break;
    case 'toggleAccount':
      await showToggleAccountQuickPick(context, onRefresh);
      break;
    case 'openDashboard':
      await onShowDetails();
      break;
    case 'refresh':
      await onRefresh(true);
      break;
    case 'setInterval':
      await setRefreshInterval(cfg);
      break;
    case 'setDisplayMode':
      await setDisplayMode(cfg, onRefresh);
      break;
    case 'setConnection':
      await setConnection(context, onRefresh);
      break;
  }
}
