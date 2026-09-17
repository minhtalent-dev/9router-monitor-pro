import { ProviderConnection, QuotaData, UsageData } from '../types';
import { formatCompact, formatResetCompact } from './formatters';

export function truncateName(name: string, maxLen: number): string {
  if (name.length <= maxLen) {
    return name;
  }
  // For emails, truncate before @
  const atIdx = name.indexOf('@');
  if (atIdx > 0 && atIdx <= maxLen - 1) {
    return name.slice(0, maxLen - 1) + '…';
  }
  return name.slice(0, maxLen - 1) + '…';
}

export function chooseQuotaName(
  usage: UsageData | undefined,
  preferred: string
): string | undefined {
  if (!usage || !usage.quotas) {
    return undefined;
  }
  if (preferred && usage.quotas[preferred]) {
    return preferred;
  }
  const priorityKeys = [
    'gemini-3.8-flash-high',
    'session',
    'weekly',
    'gemini_weekly',
    'claude_gpt_weekly',
    'claude-sonnet-4-6'
  ];
  for (const key of priorityKeys) {
    if (usage.quotas[key]) {
      return key;
    }
  }
  return Object.keys(usage.quotas)[0];
}

export function displayName(connection: ProviderConnection): string {
  return connection.name ?? connection.email ?? connection.provider ?? connection.id;
}

export function connectionPlan(connection: ProviderConnection): string | undefined {
  return toOptionalString(connection.providerSpecificData.chatgptPlanType);
}

export function quotaTitle(name: string): string {
  switch (name) {
    case 'gemini-3.8-flash-high':
      return 'Gemini 3.8 Flash';
    case 'gemini_weekly':
      return 'Gemini Weekly';
    case 'claude_gpt_weekly':
      return 'Claude & GPT Weekly';
    case 'claude-sonnet-4-6':
      return 'Claude Sonnet 4.6';
    case 'session':
      return 'Session';
    case 'weekly':
      return 'Weekly';
    default:
      return name;
  }
}

export function quotaShortName(name: string): string {
  switch (name) {
    case 'gemini-3.8-flash-high':
      return 'G3.8';
    case 'gemini_weekly':
      return 'GW';
    case 'claude_gpt_weekly':
      return 'CW';
    case 'claude-sonnet-4-6':
      return 'CS4.6';
    case 'session':
      return 'S';
    case 'weekly':
      return 'W';
    default:
      return name.length > 6 ? name.slice(0, 5) + '…' : name;
  }
}

export function formatQuotaForStatus(
  name: string,
  quota: QuotaData,
  mode: 'compact' | 'detailed' | 'minimal' = 'detailed'
): string {
  const short = quotaShortName(name);
  if (quota.unlimited) {
    const resetStr =
      mode === 'detailed' ? formatResetCompact(quota.resetAt) : '';
    const resetTag = resetStr ? ` (${resetStr})` : '';
    return `${short} ∞${resetTag}`;
  }
  if (mode === 'detailed') {
    const resetStr = formatResetCompact(quota.resetAt);
    const resetTag = resetStr ? ` (${resetStr})` : '';
    return `${short} ${formatCompact(quota.remaining)}/${formatCompact(
      quota.total
    )}${resetTag}`;
  }
  return `${short} ${formatCompact(quota.remaining)}`;
}

export function getUsedPercent(quota: QuotaData): number {
  if (quota.unlimited || quota.total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (quota.used / quota.total) * 100));
}

export function getRemainingPercent(quota: QuotaData): number {
  if (quota.unlimited) {
    return 100;
  }
  if (quota.total <= 0) {
    return 100;
  }
  return Math.min(100, Math.max(0, (quota.remaining / quota.total) * 100));
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function toNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

export function toOptionalNumber(value: unknown): number | undefined {
  const n = toNumber(value, Number.NaN);
  return Number.isFinite(n) ? n : undefined;
}

export function toOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return String(value);
}

export function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') {
      return true;
    }
    if (value.toLowerCase() === 'false') {
      return false;
    }
  }
  return fallback;
}
