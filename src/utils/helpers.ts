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
  const lower = (name || '').toLowerCase();
  if (lower.includes('gemini-3.8') || lower === 'g3.8') return 'G3.8';
  if (lower.includes('gemini-3.5')) return 'G3.5';
  if (lower.includes('gemini-2.5')) return 'G2.5';
  if (lower.includes('gemini-flash')) return 'Flash';
  if (lower.includes('gemini-pro')) return 'GPro';
  if (lower.includes('gemini_weekly') || lower === 'gw') return 'GW';
  if (lower.includes('claude-sonnet-4-6') || lower.includes('sonnet-4.6')) return 'CS4.6';
  if (lower.includes('claude-3-7-sonnet') || lower.includes('sonnet-3.7')) return 'CS3.7';
  if (lower.includes('claude-3-5-sonnet') || lower.includes('sonnet-3.5')) return 'CS3.5';
  if (lower.includes('claude_gpt_weekly') || lower === 'cw') return 'CW';
  if (lower.includes('claude') || lower.includes('sonnet')) return 'Claude';
  if (lower.includes('gpt-4.5')) return 'GPT4.5';
  if (lower.includes('gpt-4o')) return 'GPT4o';
  if (lower.includes('gpt-4')) return 'GPT4';
  if (lower.includes('deepseek-r1')) return 'DSR1';
  if (lower.includes('deepseek-v3')) return 'DSV3';
  if (lower.includes('deepseek')) return 'DeepSeek';
  if (lower.includes('session')) return 'S';
  if (lower.includes('weekly')) return 'W';
  return name.length > 7 ? name.slice(0, 6) + '…' : name;
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
