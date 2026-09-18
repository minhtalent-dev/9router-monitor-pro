import * as vscode from 'vscode';
import { DashboardData, ExtensionConfig, RequestLogItem, UsageStats } from '../types';

let currentContext: vscode.ExtensionContext | undefined;
let lastDashboard: DashboardData | undefined;
let lastError: string | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let logStatusBarItem: vscode.StatusBarItem | undefined;
let detailsPanel: vscode.WebviewPanel | undefined;
let activeConfig: ExtensionConfig | undefined;
let lastUsageStats: UsageStats | undefined;
let lastRecentLogs: RequestLogItem[] = [];
let logTooltipLimit: number = 10;

export function getLastUsageStats(): UsageStats | undefined {
  return lastUsageStats;
}

export function setLastUsageStats(stats: UsageStats | undefined): void {
  lastUsageStats = stats;
}

export function getLastRecentLogs(): RequestLogItem[] {
  return lastRecentLogs;
}

export function setLastRecentLogs(logs: RequestLogItem[]): void {
  lastRecentLogs = logs;
}

export function getLogTooltipLimit(): number {
  return logTooltipLimit;
}

export function setLogTooltipLimit(limit: number): void {
  logTooltipLimit = Math.max(1, Math.min(50, limit));
}

export function getActiveConfig(): ExtensionConfig | undefined {
  return activeConfig;
}

export function setActiveConfig(cfg: ExtensionConfig | undefined): void {
  activeConfig = cfg;
}

export function getCurrentContext(): vscode.ExtensionContext | undefined {
  return currentContext;
}

export function setCurrentContext(context: vscode.ExtensionContext | undefined): void {
  currentContext = context;
}

export function getLastDashboard(): DashboardData | undefined {
  return lastDashboard;
}

export function setLastDashboard(dashboard: DashboardData | undefined): void {
  lastDashboard = dashboard;
}

export function getLastError(): string | undefined {
  return lastError;
}

export function setLastError(error: string | undefined): void {
  lastError = error;
}

export function getStatusBarItem(): vscode.StatusBarItem | undefined {
  return statusBarItem;
}

export function setStatusBarItem(item: vscode.StatusBarItem | undefined): void {
  statusBarItem = item;
}

export function getLogStatusBarItem(): vscode.StatusBarItem | undefined {
  return logStatusBarItem;
}

export function setLogStatusBarItem(item: vscode.StatusBarItem | undefined): void {
  logStatusBarItem = item;
}

export function getDetailsPanel(): vscode.WebviewPanel | undefined {
  return detailsPanel;
}

export function setDetailsPanel(panel: vscode.WebviewPanel | undefined): void {
  detailsPanel = panel;
}

// Persistent Preferences

export function getPinnedAccountIds(context?: vscode.ExtensionContext): string[] {
  const ctx = context ?? currentContext;
  if (!ctx) {
    return [];
  }
  const stored = ctx.globalState.get<string[]>('aiTokenUsage.pinnedAccountIds');
  if (Array.isArray(stored)) {
    return stored;
  }
  const oldSingle = ctx.globalState.get<string>('aiTokenUsage.pinnedAccountId');
  if (oldSingle) {
    const migrated = [oldSingle];
    void ctx.globalState.update('aiTokenUsage.pinnedAccountIds', migrated);
    void ctx.globalState.update('aiTokenUsage.pinnedAccountId', undefined);
    return migrated;
  }
  return [];
}

export async function setPinnedAccountIds(
  context: vscode.ExtensionContext,
  ids: string[]
): Promise<void> {
  await context.globalState.update('aiTokenUsage.pinnedAccountIds', ids);
}

export function getPinnedModels(context?: vscode.ExtensionContext): string[] {
  const ctx = context ?? currentContext;
  if (!ctx) {
    return [];
  }
  const stored = ctx.globalState.get<string[]>('aiTokenUsage.pinnedModels');
  if (Array.isArray(stored)) {
    return stored;
  }
  const oldSingle = ctx.globalState.get<string>('aiTokenUsage.pinnedModel');
  if (oldSingle) {
    const migrated = [oldSingle];
    void ctx.globalState.update('aiTokenUsage.pinnedModels', migrated);
    void ctx.globalState.update('aiTokenUsage.pinnedModel', undefined);
    return migrated;
  }
  return [];
}

export async function setPinnedModels(
  context: vscode.ExtensionContext,
  models: string[]
): Promise<void> {
  await context.globalState.update('aiTokenUsage.pinnedModels', models);
}

export function getPreferredSort(context?: vscode.ExtensionContext): string {
  const ctx = context ?? currentContext;
  return ctx?.globalState.get<string>('aiTokenUsage.preferredSort') ?? 'used_desc';
}

export async function setPreferredSort(
  context: vscode.ExtensionContext,
  sort: string
): Promise<void> {
  await context.globalState.update('aiTokenUsage.preferredSort', sort);
}

export function getPreferredFilter(context?: vscode.ExtensionContext): string {
  const ctx = context ?? currentContext;
  return ctx?.globalState.get<string>('aiTokenUsage.preferredFilter') ?? 'all';
}

export async function setPreferredFilter(
  context: vscode.ExtensionContext,
  filter: string
): Promise<void> {
  await context.globalState.update('aiTokenUsage.preferredFilter', filter);
}

export function getHiddenModels(context?: vscode.ExtensionContext): string[] {
  const ctx = context ?? currentContext;
  return ctx?.globalState.get<string[]>('aiTokenUsage.hiddenModels') ?? [];
}

export async function setHiddenModels(
  context: vscode.ExtensionContext,
  hiddenModels: string[]
): Promise<void> {
  await context.globalState.update('aiTokenUsage.hiddenModels', hiddenModels);
}

export function getStatusDisplayMode(): 'compact' | 'detailed' | 'minimal' {
  return vscode.workspace
    .getConfiguration('aiTokenUsage')
    .get<'compact' | 'detailed' | 'minimal'>('statusDisplayMode', 'compact');
}

export async function setStatusDisplayMode(
  mode: 'compact' | 'detailed' | 'minimal'
): Promise<void> {
  if (activeConfig) {
    activeConfig.statusDisplayMode = mode;
  }
  await vscode.workspace
    .getConfiguration('aiTokenUsage')
    .update('statusDisplayMode', mode, vscode.ConfigurationTarget.Global);
}

export function getTooltipDisplayMode(): 'all' | 'summary' | 'accounts' {
  return vscode.workspace
    .getConfiguration('aiTokenUsage')
    .get<'all' | 'summary' | 'accounts'>('tooltipDisplayMode', 'all');
}

export async function setTooltipDisplayMode(
  mode: 'all' | 'summary' | 'accounts'
): Promise<void> {
  if (activeConfig) {
    activeConfig.tooltipDisplayMode = mode;
  }
  await vscode.workspace
    .getConfiguration('aiTokenUsage')
    .update('tooltipDisplayMode', mode, vscode.ConfigurationTarget.Global);
}

export function getLogTooltipDisplayMode(
  context?: vscode.ExtensionContext
): 'all' | 'summary' | 'logs' {
  return vscode.workspace
    .getConfiguration('aiTokenUsage')
    .get<'all' | 'summary' | 'logs'>('logTooltipDisplayMode', 'all');
}

export async function setLogTooltipDisplayMode(
  mode: 'all' | 'summary' | 'logs',
  context?: vscode.ExtensionContext
): Promise<void> {
  if (activeConfig) {
    activeConfig.logTooltipDisplayMode = mode;
  }
  await vscode.workspace
    .getConfiguration('aiTokenUsage')
    .update('logTooltipDisplayMode', mode, vscode.ConfigurationTarget.Global);
}

export function getLogStatusDisplayMode(
  context?: vscode.ExtensionContext
): 'minimal' | 'compact' | 'detailed' {
  return vscode.workspace
    .getConfiguration('aiTokenUsage')
    .get<'minimal' | 'compact' | 'detailed'>('logStatusDisplayMode', 'minimal');
}

export async function setLogStatusDisplayMode(
  mode: 'minimal' | 'compact' | 'detailed',
  context?: vscode.ExtensionContext
): Promise<void> {
  if (activeConfig) {
    activeConfig.logStatusDisplayMode = mode;
  }
  await vscode.workspace
    .getConfiguration('aiTokenUsage')
    .update('logStatusDisplayMode', mode, vscode.ConfigurationTarget.Global);
}


