import * as vscode from 'vscode';
import * as fs from 'fs';
import { DashboardData, ExtensionConfig } from '../types';
import {
  getPinnedAccountIds,
  getPinnedModels,
  getPreferredFilter
} from '../services/stateManager';
import { escHtml, formatDate } from '../utils/formatters';
import { getDashboardStyles } from './styles/dashboardStyles';
import { getDashboardScript } from './scripts/dashboardScript';
import { renderProvidersTab } from './tabs/providersTab';
import { renderAnalyticsTab } from './tabs/analyticsTab';
import { renderConsoleLogTab } from './tabs/consoleLogTab';

export function getWebviewContent(
  data: DashboardData,
  context: vscode.ExtensionContext,
  cfg: ExtensionConfig,
  pinnedAccountIds = getPinnedAccountIds(context),
  pinnedModels = getPinnedModels(context),
  initialTab: 'providers' | 'analytics' | 'console' = 'providers'
): string {
  const preferredFilter = getPreferredFilter(context);

  let iconBase64 = '';
  try {
    const iconPath = vscode.Uri.joinPath(
      context.extensionUri,
      'media',
      'icon.png'
    ).fsPath;
    if (fs.existsSync(iconPath)) {
      iconBase64 = `data:image/png;base64,${fs
        .readFileSync(iconPath)
        .toString('base64')}`;
    }
  } catch {}

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
${getDashboardStyles()}
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>${
        iconBase64
          ? `<img src="${iconBase64}" class="logo" style="width: 28px; height: 28px; vertical-align: middle; border-radius: 6px; margin-right: 8px; box-shadow: 0 0 12px rgba(0, 180, 255, 0.4);" alt="Logo" />`
          : '<span class="logo">🖥️</span>'
      } 9Router Monitor Pro</h1>
      <div class="updated">Updated: ${escHtml(formatDate(data.fetchedAt.toISOString()))} · Auto-refresh: ${cfg.intervalSeconds}s</div>
    </div>
    <div class="header-actions">
      <button class="btn btn-primary" id="refreshBtn">⟳ Refresh</button>
      <button class="btn" id="setConnectionBtn">⚙ Setup Connection</button>
    </div>
  </div>

  <div class="tabs-header">
    <button class="tab-btn ${initialTab === 'providers' ? 'active' : ''}" data-tab="providers">📊 Providers & Quotas</button>
    <button class="tab-btn ${initialTab === 'analytics' ? 'active' : ''}" data-tab="analytics">📈 Usage & Analytics</button>
    <button class="tab-btn ${initialTab === 'console' ? 'active' : ''}" data-tab="console">🖥️ Live Console Log</button>
  </div>

${renderProvidersTab(data, context, cfg, pinnedAccountIds, pinnedModels, initialTab)}

${renderAnalyticsTab(initialTab)}

${renderConsoleLogTab(initialTab)}

  <script>
${getDashboardScript(initialTab, preferredFilter)}
  </script>
</body>
</html>`;
}
