import * as vscode from 'vscode';
import { DashboardData } from '../types';

let currentContext: vscode.ExtensionContext | undefined;
let lastDashboard: DashboardData | undefined;
let lastError: string | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let detailsPanel: vscode.WebviewPanel | undefined;

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
