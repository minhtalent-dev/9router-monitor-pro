import * as vscode from 'vscode';
import {
  AuthContext,
  DashboardData,
  ExtensionConfig,
  ProviderConnection,
  ProviderTestResult,
  ProviderUsage,
  QuotaData,
  TestAllSummary,
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
import { logDebug, logInfo, logWarn, logError } from '../utils/logger';

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
  logDebug('Quota', `Fetching providers list from ${providersUrl.toString()}...`);
  const providersJson = await fetchJson(providersUrl, auth);
  const connections = parseProviders(providersJson).sort(
    (a, b) => a.priority - b.priority
  );
  logDebug('Quota', `Found ${connections.length} active provider connections.`);

  const startTime = Date.now();
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
            logWarn('Quota', `Attempt 1 failed for ${connection.name || connection.id}: ${lastErr.message}. Retrying...`);
            await new Promise((r) => setTimeout(r, 600));
          }
        }
      }

      const cached = usageCache.get(connection.id);
      if (cached) {
        logWarn('Quota', `Provider ${connection.id} failed both attempts. Using cached quota.`);
        return {
          connection,
          usage: cached,
          warning: 'Latest refresh timed out. Showing cached quota.'
        };
      }

      logError('Quota', `Provider ${connection.id} failed quota fetch: ${lastErr?.message}`);
      return {
        connection,
        error: lastErr?.message ?? 'Request timed out.'
      };
    }
  );

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  logInfo('Quota', `Synced quota for ${items.length} accounts in ${durationSec}s.`);

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
  logInfo('Quota', `Updating provider ${connectionId} active status to ${isActive}...`);
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
    logError('Quota', `Failed to update provider ${connectionId} active status: HTTP ${res.status}`);
    throw new Error(`HTTP ${res.status}`);
  }
  logInfo('Quota', `Provider ${connectionId} active status successfully updated to ${isActive}.`);
  return true;
}

export async function testProviderConnection(
  cfg: ExtensionConfig,
  auth: AuthContext,
  connection: ProviderConnection
): Promise<ProviderTestResult> {
  const target = buildUrl(
    cfg.baseUrl,
    `/api/providers/${encodeURIComponent(connection.id)}/test`
  );
  const startTime = Date.now();
  const connName = connection.name || connection.email || connection.id;

  try {
    const res = await requestWithAuth<{
      valid?: boolean;
      error?: string | null;
      refreshed?: boolean;
    }>(target, auth, {
      method: 'POST'
    });
    const latencyMs = Date.now() - startTime;
    const data = res.data;

    if (res.status >= 200 && res.status < 300 && data) {
      const isValid = Boolean(data.valid);
      const errStr = data.error ?? (isValid ? null : `HTTP ${res.status}`);
      return {
        id: connection.id,
        name: connName,
        provider: connection.provider,
        valid: isValid,
        error: errStr,
        refreshed: Boolean(data.refreshed),
        latencyMs
      };
    }

    return {
      id: connection.id,
      name: connName,
      provider: connection.provider,
      valid: false,
      error: `HTTP ${res.status}`,
      refreshed: false,
      latencyMs
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const msg = err instanceof Error ? err.message : String(err);
    logWarn('Quota', `Test connection ${connName} failed: ${msg}`);
    return {
      id: connection.id,
      name: connName,
      provider: connection.provider,
      valid: false,
      error: msg,
      refreshed: false,
      latencyMs
    };
  }
}

export async function testAllProviderConnections(
  cfg: ExtensionConfig,
  auth: AuthContext,
  connections: ProviderConnection[],
  onProgress?: (
    done: number,
    total: number,
    current: ProviderConnection,
    result?: ProviderTestResult
  ) => void,
  cancellationToken?: vscode.CancellationToken
): Promise<TestAllSummary> {
  const total = connections.length;
  let done = 0;
  let cancelled = false;

  const results: ProviderTestResult[] = [];
  let index = 0;
  const workerCount = Math.min(3, Math.max(1, connections.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (index < connections.length) {
      if (cancellationToken?.isCancellationRequested) {
        cancelled = true;
        break;
      }
      const i = index++;
      const conn = connections[i];
      const res = await testProviderConnection(cfg, auth, conn);
      results.push(res);
      done++;
      onProgress?.(done, total, conn, res);
    }
  });

  await Promise.all(workers);

  const passed = results.filter((r) => r.valid).length;
  const failed = results.filter((r) => !r.valid).length;
  const totalLatency = results.reduce((acc, r) => acc + r.latencyMs, 0);
  const avgLatencyMs =
    results.length > 0 ? Math.round(totalLatency / results.length) : 0;

  return {
    total,
    passed,
    failed,
    cancelled,
    avgLatencyMs,
    results
  };
}

