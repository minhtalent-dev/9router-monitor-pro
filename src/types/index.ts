import * as vscode from 'vscode';

export interface ProviderConnection {
  id: string;
  provider: string;
  authType?: string;
  name?: string;
  email?: string;
  priority: number;
  isActive: boolean;
  testStatus?: string;
  expiresAt?: string;
  expiresIn?: number;
  lastRefreshAt?: string;
  lastUsedAt?: string;
  consecutiveUseCount?: number;
  createdAt?: string;
  updatedAt?: string;
  providerSpecificData: Record<string, unknown>;
}

export interface QuotaData {
  used: number;
  total: number;
  remaining: number;
  resetAt?: string;
  unlimited: boolean;
}

export interface UsageData {
  plan?: string;
  limitReached: boolean;
  reviewLimitReached: boolean;
  quotas: Record<string, QuotaData>;
}

export interface ProviderUsage {
  connection: ProviderConnection;
  usage?: UsageData;
  error?: string;
  warning?: string;
}

export interface DashboardData {
  items: ProviderUsage[];
  primary?: ProviderUsage;
  fetchedAt: Date;
}

export interface UsageStats {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCachedTokens: number;
  totalCost: number;
  byProvider?: Record<string, { requests: number; promptTokens: number; completionTokens: number; cost: number }>;
  byModel?: Record<string, { requests: number; promptTokens: number; completionTokens: number }>;
}

export interface RequestLogItem {
  raw: string;
  timestamp: string;
  model: string;
  provider: string;
  account: string;
  inTokens: number;
  outTokens: number;
  status: string;
}

export type ConsoleStreamMessage =
  | { type: 'init'; logs: string[] }
  | { type: 'line'; line: string }
  | { type: 'lines'; lines: string[] }
  | { type: 'clear' };

export interface ExtensionConfig {
  baseUrl: string;
  providersPath: string;
  usagePathTemplate: string;
  statusBarQuota: string;
  intervalSeconds: number;
  statusDisplayMode: 'compact' | 'detailed' | 'minimal';
  tooltipDisplayMode: 'all' | 'summary' | 'accounts';
  showLogStatusBar: boolean;
  logStatusBarRefreshIntervalSeconds?: number;
}

export interface AuthContext {
  authToken?: string;
  password?: string;
  cliToken?: string;
  legacyApiKey?: string;
  baseUrl: string;
  context: vscode.ExtensionContext;
}

export interface IntervalOption {
  label: string;
  description: string;
  seconds: number;
  isCustom?: boolean;
}
