import {
  AuthContext,
  DashboardData,
  ExtensionConfig,
  ProviderConnection,
  ProviderUsage,
  QuotaData,
  UsageData
} from '../types';
import {
  asRecord,
  toBoolean,
  toNumber,
  toOptionalNumber,
  toOptionalString
} from '../utils/helpers';
import { buildUrl, fetchJson, requestWithAuth } from './httpTransport';

export const usageCache = new Map<string, UsageData>();

export function buildUsagePath(template: string, providerId: string): string {
  if (template.includes('{id}')) {
    return template.replace(/\{id\}/g, encodeURIComponent(providerId));
  }
  const separator = template.endsWith('/') ? '' : '/';
  return `${template}${separator}${encodeURIComponent(providerId)}`;
}

export function normalizeQuota(raw: unknown): QuotaData {
  const record = asRecord(raw) ?? {};
  const used = toNumber(record.used, 0);
  const total = toNumber(record.total, 0);
  const remaining =
    record.remaining === undefined || record.remaining === null
      ? Math.max(0, total - used)
      : toNumber(record.remaining, 0);

  return {
    used,
    total,
    remaining,
    resetAt: toOptionalString(record.resetAt),
    unlimited: toBoolean(record.unlimited, false)
  };
}

export function parseUsage(json: unknown): UsageData {
  const record = asRecord(json) ?? {};
  const quotasRecord = asRecord(record.quotas) ?? {};
  const quotas: Record<string, QuotaData> = {};

  for (const [name, rawQuota] of Object.entries(quotasRecord)) {
    if (asRecord(rawQuota)) {
      quotas[name] = normalizeQuota(rawQuota);
    }
  }

  return {
    plan: toOptionalString(record.plan),
    limitReached: toBoolean(record.limitReached, false),
    reviewLimitReached: toBoolean(record.reviewLimitReached, false),
    quotas
  };
}

export function normalizeProvider(raw: unknown): ProviderConnection | undefined {
  const record = asRecord(raw);
  const id = toOptionalString(record?.id);
  if (!record || !id) {
    return undefined;
  }

  const providerSpecificData = asRecord(record.providerSpecificData) ?? {};
  return {
    id,
    provider: toOptionalString(record.provider) ?? 'unknown',
    authType: toOptionalString(record.authType),
    name: toOptionalString(record.name),
    email: toOptionalString(record.email),
    priority: toNumber(record.priority, Number.MAX_SAFE_INTEGER),
    isActive: toBoolean(record.isActive, false),
    testStatus: toOptionalString(record.testStatus),
    expiresAt: toOptionalString(record.expiresAt),
    expiresIn: toOptionalNumber(record.expiresIn),
    lastRefreshAt: toOptionalString(record.lastRefreshAt),
    lastUsedAt: toOptionalString(record.lastUsedAt),
    consecutiveUseCount: toOptionalNumber(record.consecutiveUseCount),
    createdAt: toOptionalString(record.createdAt),
    updatedAt: toOptionalString(record.updatedAt),
    providerSpecificData
  };
}

export function parseProviders(json: unknown): ProviderConnection[] {
  const root = asRecord(json);
  const rawConnections = Array.isArray(root?.connections)
    ? root.connections
    : [];

  return rawConnections
    .map((raw) => normalizeProvider(raw))
    .filter((provider): provider is ProviderConnection => provider !== undefined);
}

export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fetchDashboard(
  cfg: ExtensionConfig,
  auth: AuthContext
): Promise<DashboardData> {
  const providersUrl = buildUrl(cfg.baseUrl, cfg.providersPath);
  const providersJson = await fetchJson(providersUrl, auth);
  const connections = parseProviders(providersJson).sort(
    (a, b) => a.priority - b.priority
  );

  const items = await mapConcurrent(
    connections,
    3,
    async (connection): Promise<ProviderUsage> => {
      const usagePath = buildUsagePath(cfg.usagePathTemplate, connection.id);
      const targetUrl = buildUrl(cfg.baseUrl, usagePath);

      let lastErr: Error | undefined;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const usageJson = await fetchJson(targetUrl, auth);
          const parsed = parseUsage(usageJson);
          usageCache.set(connection.id, parsed);
          return { connection, usage: parsed };
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error(String(err));
          if (attempt === 1) {
            await new Promise((r) => setTimeout(r, 600));
          }
        }
      }

      const cached = usageCache.get(connection.id);
      if (cached) {
        return {
          connection,
          usage: cached,
          warning: 'Latest refresh timed out. Showing cached quota.'
        };
      }

      return {
        connection,
        error: lastErr?.message ?? 'Request timed out.'
      };
    }
  );

  return {
    items,
    primary: items.find((item) => item.connection.priority === 1) ?? items[0],
    fetchedAt: new Date()
  };
}

export async function updateProviderActive(
  auth: AuthContext,
  connectionId: string | number,
  isActive: boolean,
  allowRetry = true
): Promise<boolean> {
  const target = buildUrl(
    auth.baseUrl,
    `/api/providers/${encodeURIComponent(String(connectionId))}`
  );
  const postData = JSON.stringify({ isActive });
  const res = await requestWithAuth(
    target,
    auth,
    {
      method: 'PUT',
      body: postData
    },
    allowRetry
  );
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}`);
  }
  return true;
}
