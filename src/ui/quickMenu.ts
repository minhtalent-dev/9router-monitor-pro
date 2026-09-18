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
import { showDetails } from './dashboardPanel';

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

export async function setDisplayMode(
  cfg: ExtensionConfig,
  onRefresh: () => Promise<void>
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 80));

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
    placeHolder: 'Select status bar display style',
    ignoreFocusOut: true
  });

  if (!selected) {
    return;
  }

  cfg.statusDisplayMode = selected.mode;
  renderStatusBar(cfg);

  const config = vscode.workspace.getConfiguration('aiTokenUsage');
  await config.update(
    'statusDisplayMode',
    selected.mode,
    vscode.ConfigurationTarget.Global
  );
  vscode.window.showInformationMessage(
    `[9Router Pro] Status Bar display style set to: ${selected.mode}`
  );
}

export async function setTooltipMode(
  cfg: ExtensionConfig,
  onRefresh: () => Promise<void>
): Promise<void> {
  // Yield execution slightly so hover tooltip dismissal does not dismiss QuickPick
  await new Promise((resolve) => setTimeout(resolve, 80));

  const currentMode = cfg.tooltipDisplayMode ?? 'all';

  interface TooltipModePickItem extends vscode.QuickPickItem {
    mode: 'all' | 'summary' | 'accounts';
  }

  const items: TooltipModePickItem[] = [
    {
      label: '$(checklist) All Details (Default)',
      description: 'Aggregate Summary + 10 Accounts Breakdown',
      detail:
        'Shows full aggregate model table followed by individual account list',
      mode: 'all',
      picked: currentMode === 'all'
    },
    {
      label: '$(table) Aggregate Summary Only',
      description: 'Clean & Compact (Model Summary table only)',
      detail:
        'Hides the long per-account list to keep the tooltip compact and prevent screen overflow',
      mode: 'summary',
      picked: currentMode === 'summary'
    },
    {
      label: '$(organization) Account List Only',
      description: 'Account Breakdown only',
      detail:
        'Shows individual account list without the top summary table',
      mode: 'accounts',
      picked: currentMode === 'accounts'
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: `9Router Monitor Pro — Tooltip Detail Level (Current: ${currentMode})`,
    placeHolder: 'Select tooltip content style',
    ignoreFocusOut: true
  });

  if (!selected) {
    return;
  }

  cfg.tooltipDisplayMode = selected.mode;
  renderStatusBar(cfg);

  const config = vscode.workspace.getConfiguration('aiTokenUsage');
  await config.update(
    'tooltipDisplayMode',
    selected.mode,
    vscode.ConfigurationTarget.Global
  );
  vscode.window.showInformationMessage(
    `[9Router Pro] Tooltip detail level set to: ${selected.mode}`
  );
}

export async function toggleTooltipMode(
  cfg: ExtensionConfig,
  onRefresh: () => Promise<void>
): Promise<void> {
  const currentMode = cfg.tooltipDisplayMode ?? 'all';
  const nextMode: 'all' | 'summary' =
    currentMode === 'summary' ? 'all' : 'summary';

  cfg.tooltipDisplayMode = nextMode;
  renderStatusBar(cfg);

  const config = vscode.workspace.getConfiguration('aiTokenUsage');
  await config.update(
    'tooltipDisplayMode',
    nextMode,
    vscode.ConfigurationTarget.Global
  );
  vscode.window.showInformationMessage(
    `[9Router Pro] Tooltip mode: ${
      nextMode === 'summary' ? 'Summary Only' : 'All Details'
    }`
  );
}

export async function setRefreshInterval(cfg: ExtensionConfig): Promise<void> {
  const currentInterval = cfg.intervalSeconds;

  const items: IntervalPickItem[] = [
    {
      label: '5 seconds (Ultra Fast)',
      description: '5s - Ultra high frequency',
      seconds: 5,
      picked: currentInterval === 5
    },
    {
      label: '10 seconds (Fast)',
      description: '10s - High frequency',
      seconds: 10,
      picked: currentInterval === 10
    },
    {
      label: '15 seconds',
      description: '15s',
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
      description: 'Custom interval in seconds (>= 5s)',
      isCustom: true
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: `9Router Monitor Pro — Auto-Refresh Interval (Current: ${currentInterval}s)`,
    placeHolder: 'Select auto-refresh interval',
    ignoreFocusOut: true
  });

  if (!selected) {
    return;
  }

  let seconds: number | undefined;

  if (selected.isCustom) {
    const input = await vscode.window.showInputBox({
      title: '9Router Monitor Pro — Custom Refresh Interval',
      prompt: 'Enter refresh interval in seconds (minimum 5 seconds)',
      value: String(currentInterval),
      ignoreFocusOut: true,
      validateInput: (val) => {
        const num = Number(val);
        if (!Number.isInteger(num) || num < 5) {
          return 'Value must be an integer >= 5 seconds.';
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
    cfg.intervalSeconds = seconds;
    vscode.window.showInformationMessage(
      `[9Router Pro] Auto-refresh interval set to ${seconds} seconds.`
    );
  }
}

export async function setLogRefreshInterval(cfg: ExtensionConfig): Promise<void> {
  const currentInterval = cfg.logStatusBarRefreshIntervalSeconds ?? 10;

  const items: IntervalPickItem[] = [
    {
      label: '3 seconds (Ultra Fast)',
      description: '3s - Near real-time log polling',
      seconds: 3,
      picked: currentInterval === 3
    },
    {
      label: '5 seconds (Fast)',
      description: '5s - High frequency log polling',
      seconds: 5,
      picked: currentInterval === 5
    },
    {
      label: '10 seconds (Default)',
      description: '10s - Recommended balance',
      seconds: 10,
      picked: currentInterval === 10
    },
    {
      label: '15 seconds',
      description: '15s',
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
      label: '60 seconds',
      description: '60s',
      seconds: 60,
      picked: currentInterval === 60
    },
    {
      label: 'Custom...',
      description: 'Custom interval in seconds (>= 3s)',
      isCustom: true
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: `9Router Monitor Pro — 9R Log Auto-Refresh Interval (Current: ${currentInterval}s)`,
    placeHolder: 'Select 9R Log refresh interval',
    ignoreFocusOut: true
  });

  if (!selected) {
    return;
  }

  let seconds: number | undefined;

  if (selected.isCustom) {
    const input = await vscode.window.showInputBox({
      title: '9Router Monitor Pro — Custom 9R Log Refresh Interval',
      prompt: 'Enter refresh interval in seconds (minimum 3 seconds)',
      value: String(currentInterval),
      ignoreFocusOut: true,
      validateInput: (val) => {
        const num = Number(val);
        if (!Number.isInteger(num) || num < 3) {
          return 'Value must be an integer >= 3 seconds.';
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
      'logStatusBarRefreshIntervalSeconds',
      seconds,
      vscode.ConfigurationTarget.Global
    );
    cfg.logStatusBarRefreshIntervalSeconds = seconds;
    vscode.window.showInformationMessage(
      `[9Router Pro] 9R Log auto-refresh interval set to ${seconds} seconds.`
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
      label: '$(terminal) Open Live Console Log',
      description: 'Open real-time 9Router server console terminal',
      detail: 'Stream live 9Router server logs, filter and inspect events',
      action: 'openConsoleLog'
    },
    {
      label:
        cfg.showLogStatusBar !== false
          ? '$(eye-closed) Hide Console Log Status Bar Item'
          : '$(eye) Show Console Log Status Bar Item',
      description: 'Toggle $(terminal) 9R Log icon visibility on status bar',
      detail: 'Show or hide dedicated 9R Log shortcut button on status bar',
      action: 'toggleLogStatusBar'
    },
    {
      label: '$(output) View Live Debug Output Logs',
      description: 'Open 9Router Monitor Pro Debug Output Channel',
      detail: 'View detailed diagnostic logs and HTTP/SSE socket traces',
      action: 'showDebugLogs'
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
        'Configure auto-refresh frequency (5s, 10s, 15s, 30s, 60s, custom)',
      action: 'setInterval'
    },
    {
      label: `$(clock) Set 9R Log Refresh Interval (${cfg.logStatusBarRefreshIntervalSeconds ?? 10}s)...`,
      description:
        'Configure 9R Log auto-refresh frequency (3s, 5s, 10s, 15s, 30s, 60s, custom)',
      action: 'setLogRefreshInterval'
    },
    {
      label: `$(symbol-color) Status Bar Display Style (${cfg.statusDisplayMode ?? 'compact'})...`,
      description: 'Compact / Detailed / Minimal',
      detail:
        'Switch between compact (balanced), full detailed, or ultra-minimal display format',
      action: 'setDisplayMode'
    },
    {
      label: `$(table) Tooltip Detail Level (${cfg.tooltipDisplayMode ?? 'all'})...`,
      description: 'All / Summary Only / Accounts Only',
      detail:
        'Configure tooltip content (Aggregate Summary only, Account List only, or All)',
      action: 'setTooltipMode'
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
    matchOnDetail: true,
    ignoreFocusOut: true
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
    case 'openConsoleLog':
      await showDetails(context, cfg, onRefresh, 'console');
      break;
    case 'toggleLogStatusBar': {
      const config = vscode.workspace.getConfiguration('aiTokenUsage');
      const nextVal = cfg.showLogStatusBar === false ? true : false;
      await config.update(
        'showLogStatusBar',
        nextVal,
        vscode.ConfigurationTarget.Global
      );
      cfg.showLogStatusBar = nextVal;
      renderStatusBar(cfg);
      vscode.window.showInformationMessage(
        `[9Router Pro] Console Log status bar item ${nextVal ? 'shown' : 'hidden'}.`
      );
      break;
    }
    case 'showDebugLogs':
      await vscode.commands.executeCommand('aiTokenUsage.showDebugLogs');
      break;
    case 'refresh':
      await onRefresh(true);
      break;
    case 'setInterval':
      await setRefreshInterval(cfg);
      break;
    case 'setLogRefreshInterval':
      await setLogRefreshInterval(cfg);
      break;
    case 'setDisplayMode':
      await setDisplayMode(cfg, onRefresh);
      break;
    case 'setTooltipMode':
      await setTooltipMode(cfg, onRefresh);
      break;
    case 'setConnection':
      await setConnection(context, onRefresh);
      break;
  }
}
