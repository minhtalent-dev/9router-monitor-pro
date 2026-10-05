import {
  ProviderConnection,
  QuotaData,
  QuotaItem,
  TargetAccount,
  UsageData
} from '../types';
import { formatCompact, formatResetCompact } from './formatters';

export function slugifyModelName(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function findMatchingQuota(
  quotas: Record<string, QuotaItem> | undefined,
  targetModel: string
): { key: string; quota: QuotaItem } | undefined {
  if (!quotas || !targetModel) {
    return undefined;
  }

  const trimmed = targetModel.trim();
  if (!trimmed) {
    return undefined;
  }

  // 1. Direct key match
  if (quotas[trimmed]) {
    return { key: trimmed, quota: quotas[trimmed] };
  }

  // 2. Case-insensitive exact match
  const lowerTarget = trimmed.toLowerCase();
  for (const [key, quota] of Object.entries(quotas)) {
    if (key.toLowerCase() === lowerTarget) {
      return { key, quota };
    }
  }

  // 3. Normalized exact match (strip -, _, spaces, dots, lowercase)
  const targetSlug = slugifyModelName(trimmed);
  if (!targetSlug) {
    return undefined;
  }

  for (const [key, quota] of Object.entries(quotas)) {
    if (slugifyModelName(key) === targetSlug) {
      return { key, quota };
    }
  }

  // 4. Prefix / Alias match (startsWith)
  const prefixMatches: Array<{ key: string; quota: QuotaItem; diff: number }> = [];
  for (const [key, quota] of Object.entries(quotas)) {
    const keySlug = slugifyModelName(key);
    if (keySlug.length >= 3 && targetSlug.length >= 3) {
      if (keySlug.startsWith(targetSlug) || targetSlug.startsWith(keySlug)) {
        prefixMatches.push({
          key,
          quota,
          diff: Math.abs(keySlug.length - targetSlug.length)
        });
      }
    }
  }

  if (prefixMatches.length > 0) {
    prefixMatches.sort((a, b) => a.diff - b.diff);
    return { key: prefixMatches[0].key, quota: prefixMatches[0].quota };
  }

  // 5. Substring match (includes)
  const substringMatches: Array<{ key: string; quota: QuotaItem; diff: number }> = [];
  for (const [key, quota] of Object.entries(quotas)) {
    const keySlug = slugifyModelName(key);
    if (keySlug.length >= 3 && targetSlug.length >= 3) {
      if (keySlug.includes(targetSlug) || targetSlug.includes(keySlug)) {
        substringMatches.push({
          key,
          quota,
          diff: Math.abs(keySlug.length - targetSlug.length)
        });
      }
    }
  }

  if (substringMatches.length > 0) {
    substringMatches.sort((a, b) => a.diff - b.diff);
    return { key: substringMatches[0].key, quota: substringMatches[0].quota };
  }

  return undefined;
}

export function collectActiveModelNames(
  targets: TargetAccount[],
  limit = 3
): string[] {
  if (!targets || targets.length === 0) {
    return [];
  }

  const priorityKeys = [
    'gemini-3.8-flash-high',
    'claude-sonnet-4-6',
    'session',
    'weekly',
    'gemini_weekly',
    'claude_gpt_weekly'
  ];

  interface ModelCandidate {
    key: string;
    normalizedKey: string;
    accountCount: number;
    totalUsed: number;
    totalRemaining: number;
    totalMax: number;
    priorityIndex: number;
  }

  const candidateMap = new Map<string, ModelCandidate>();

  for (const t of targets) {
    const quotas = t.usage?.quotas;
    if (!quotas) {
      continue;
    }
    for (const [key, q] of Object.entries(quotas)) {
      const norm = slugifyModelName(key);
      if (!norm) {
        continue;
      }

      let groupKey = norm;
      for (const [existingNorm] of candidateMap.entries()) {
        if (
          existingNorm === norm ||
          (existingNorm.length >= 6 &&
            norm.length >= 6 &&
            (existingNorm.startsWith(norm) || norm.startsWith(existingNorm)))
        ) {
          groupKey = existingNorm;
          break;
        }
      }

      let cand = candidateMap.get(groupKey);
      if (!cand) {
        let pIndex = priorityKeys.findIndex((pk) => {
          const pNorm = slugifyModelName(pk);
          return (
            pNorm === norm ||
            norm.startsWith(pNorm) ||
            pNorm.startsWith(norm)
          );
        });
        if (pIndex === -1) {
          pIndex = 999;
        }
        cand = {
          key,
          normalizedKey: norm,
          accountCount: 0,
          totalUsed: 0,
          totalRemaining: 0,
          totalMax: 0,
          priorityIndex: pIndex
        };
        candidateMap.set(groupKey, cand);
      }

      cand.accountCount += 1;
      cand.totalUsed += q.used ?? 0;
      cand.totalRemaining += q.remaining ?? 0;
      cand.totalMax += q.total ?? 0;
    }
  }

  const candidates = Array.from(candidateMap.values());
  if (candidates.length === 0) {
    return [];
  }

  candidates.sort((a, b) => {
    const aUsed = a.totalUsed > 0 ? 1 : 0;
    const bUsed = b.totalUsed > 0 ? 1 : 0;
    if (aUsed !== bUsed) {
      return bUsed - aUsed;
    }
    if (a.accountCount !== b.accountCount) {
      return b.accountCount - a.accountCount;
    }
    if (a.priorityIndex !== b.priorityIndex) {
      return a.priorityIndex - b.priorityIndex;
    }
    if (a.totalMax !== b.totalMax) {
      return b.totalMax - a.totalMax;
    }
    return b.totalRemaining - a.totalRemaining;
  });

  return candidates.slice(0, Math.max(1, limit)).map((c) => c.key);
}

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
  if (preferred) {
    const match = findMatchingQuota(usage.quotas, preferred);
    if (match) {
      return match.key;
    }
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
    const match = findMatchingQuota(usage.quotas, key);
    if (match) {
      return match.key;
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
  if (quota.total <= 0) {
    return `${short} —`;
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
