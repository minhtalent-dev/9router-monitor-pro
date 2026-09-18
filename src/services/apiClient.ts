import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import {
  AuthContext,
  ConsoleStreamMessage,
  DashboardData,
  ExtensionConfig,
  ProviderConnection,
  ProviderUsage,
  QuotaData,
  RequestLogItem,
  UsageData,
  UsageStats
} from '../types';
import {
  asRecord,
  toBoolean,
  toNumber,
  toOptionalNumber,
  toOptionalString
} from '../utils/helpers';
import {
  getAllLocalCliTokens,
  loginDashboard,
  SECRET_SESSION_TOKEN
} from './authManager';

export const usageCache = new Map<string, UsageData>();

export function buildUrl(baseUrl: string, pathOrUrl: string): URL {
  try {
    return new URL(pathOrUrl, baseUrl);
  } catch {
    throw new Error(`Invalid URL: ${baseUrl} + ${pathOrUrl}`);
  }
}

export function buildUsagePath(template: string, providerId: string): string {
  if (template.includes('{id}')) {
    return template.replace(/\{id\}/g, encodeURIComponent(providerId));
  }
  const separator = template.endsWith('/') ? '' : '/';
  return `${template}${separator}${encodeURIComponent(providerId)}`;
}

export function fetchJson(
  target: URL,
  auth: AuthContext,
  allowRetry = true
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const client = target.protocol === 'http:' ? http : https;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'vscode-9router-monitor-pro'
    };

    if (auth.authToken) {
      headers['Cookie'] = `auth_token=${auth.authToken}`;
    }
    if (auth.cliToken) {
      headers['x-9r-cli-token'] = auth.cliToken;
    }
    if (auth.legacyApiKey) {
      headers['Authorization'] = `Bearer ${auth.legacyApiKey}`;
      headers['x-api-key'] = auth.legacyApiKey;
    }

    const req = client.request(
      target,
      {
        method: 'GET',
        headers
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', async () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode ?? 0;

          if (status === 401 && allowRetry && auth.password) {
            try {
              const newToken = await loginDashboard(auth.baseUrl, auth.password);
              auth.authToken = newToken;
              await auth.context.secrets.store(SECRET_SESSION_TOKEN, newToken);
              const retryResult = await fetchJson(target, auth, false);
              resolve(retryResult);
              return;
            } catch (loginErr) {
              const msg = loginErr instanceof Error ? loginErr.message : String(loginErr);
              reject(new Error(`HTTP 401 (re-login failed): ${msg}`));
              return;
            }
          }

          if (status < 200 || status >= 300) {
            reject(new Error(`HTTP ${status}: ${body.slice(0, 200)}`));
            return;
          }

          try {
            resolve(JSON.parse(body) as unknown);
          } catch {
            reject(new Error('Failed to parse JSON response.'));
          }
        });
      }
    );

    req.setTimeout(25000, () => {
      req.destroy(new Error('Request timed out (25s).'));
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

export interface RequestOptions {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

export function requestWithAuth<T = unknown>(
  target: URL,
  auth: AuthContext,
  options: RequestOptions = {},
  allowRetry = true
): Promise<{ status: number; data?: T }> {
  return new Promise((resolve, reject) => {
    const client = target.protocol === 'http:' ? http : https;
    const method = options.method ?? 'GET';
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'vscode-9router-monitor-pro',
      ...(options.headers ?? {})
    };

    if (auth.authToken) {
      headers['Cookie'] = `auth_token=${auth.authToken}`;
    }
    if (auth.cliToken) {
      headers['x-9r-cli-token'] = auth.cliToken;
    }
    if (auth.legacyApiKey) {
      headers['Authorization'] = `Bearer ${auth.legacyApiKey}`;
      headers['x-api-key'] = auth.legacyApiKey;
    }
    if (options.body) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(options.body));
    }

    const req = client.request(
      target,
      {
        method,
        headers
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', async () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode ?? 0;

          if (status === 401 && allowRetry && auth.password) {
            try {
              const newToken = await loginDashboard(auth.baseUrl, auth.password);
              auth.authToken = newToken;
              await auth.context.secrets.store(SECRET_SESSION_TOKEN, newToken);
              const retryResult = await requestWithAuth<T>(
                target,
                auth,
                options,
                false
              );
              resolve(retryResult);
              return;
            } catch (loginErr) {
              const msg =
                loginErr instanceof Error ? loginErr.message : String(loginErr);
              reject(new Error(`HTTP 401 (re-login failed): ${msg}`));
              return;
            }
          }

          let data: T | undefined;
          if (body) {
            try {
              data = JSON.parse(body) as T;
            } catch {
              data = body as unknown as T;
            }
          }

          resolve({ status, data });
        });
      }
    );

    req.setTimeout(25000, () => {
      req.destroy(new Error('Request timed out (25s).'));
    });
    req.on('error', (err) => reject(err));
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
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

export function updateProviderActive(
  auth: AuthContext,
  connectionId: string,
  isActive: boolean,
  allowRetry = true
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    let target: URL;
    try {
      target = buildUrl(
        auth.baseUrl,
        `/api/providers/${encodeURIComponent(connectionId)}`
      );
    } catch (err) {
      reject(err);
      return;
    }

    const client = target.protocol === 'http:' ? http : https;
    const postData = JSON.stringify({ isActive });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(postData)),
      Accept: 'application/json',
      'User-Agent': 'vscode-9router-monitor-pro'
    };

    if (auth.authToken) {
      headers['Cookie'] = `auth_token=${auth.authToken}`;
    }
    if (auth.cliToken) {
      headers['x-9r-cli-token'] = auth.cliToken;
    }
    if (auth.legacyApiKey) {
      headers['Authorization'] = `Bearer ${auth.legacyApiKey}`;
      headers['x-api-key'] = auth.legacyApiKey;
    }

    const req = client.request(
      target,
      {
        method: 'PUT',
        headers
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', async () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode ?? 0;

          if (status === 401 && allowRetry && auth.password) {
            try {
              const newToken = await loginDashboard(auth.baseUrl, auth.password);
              auth.authToken = newToken;
              await auth.context.secrets.store(SECRET_SESSION_TOKEN, newToken);
              const retryResult = await updateProviderActive(
                auth,
                connectionId,
                isActive,
                false
              );
              resolve(retryResult);
              return;
            } catch (loginErr) {
              const msg =
                loginErr instanceof Error ? loginErr.message : String(loginErr);
              reject(new Error(`HTTP 401 (re-login failed): ${msg}`));
              return;
            }
          }

          if (status < 200 || status >= 300) {
            reject(new Error(`HTTP ${status}: ${body.slice(0, 200)}`));
            return;
          }

          resolve(true);
        });
      }
    );

    req.setTimeout(15000, () => {
      req.destroy(new Error('Request timed out (15s).'));
    });
    req.on('error', (err) => reject(err));
    req.write(postData);
    req.end();
  });
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

export async function fetchUsageStats(
  config: ExtensionConfig,
  auth: AuthContext
): Promise<UsageStats | undefined> {
  try {
    const target = buildUrl(config.baseUrl, '/api/usage/stats');
    const res = await requestWithAuth<UsageStats | { data: UsageStats }>(
      target,
      auth,
      { method: 'GET' }
    );
    if (res.status >= 200 && res.status < 300 && res.data) {
      const rec = asRecord(res.data);
      if (rec && asRecord(rec.data)) {
        return rec.data as unknown as UsageStats;
      }
      return res.data as UsageStats;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function fetchRequestLogs(
  config: ExtensionConfig,
  auth: AuthContext,
  page = 1,
  limit = 20
): Promise<RequestLogItem[]> {
  try {
    const target = buildUrl(
      config.baseUrl,
      `/api/usage/request-logs?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`
    );
    const res = await requestWithAuth<unknown>(target, auth, { method: 'GET' });
    if (res.status < 200 || res.status >= 300 || !res.data) {
      return [];
    }

    let rawList: unknown[] = [];
    if (Array.isArray(res.data)) {
      rawList = res.data;
    } else if (asRecord(res.data)) {
      const record = asRecord(res.data)!;
      if (Array.isArray(record.logs)) {
        rawList = record.logs;
      } else if (Array.isArray(record.data)) {
        rawList = record.data;
      }
    }

    return rawList.map((item): RequestLogItem => {
      if (typeof item === 'string') {
        const parts = item.split(' | ').map((s) => s.trim());
        return {
          raw: item,
          timestamp: parts[0] ?? '',
          model: parts[1] ?? '',
          provider: parts[2] ?? '',
          account: parts[3] ?? '',
          inTokens: parseInt(parts[4] ?? '0', 10) || 0,
          outTokens: parseInt(parts[5] ?? '0', 10) || 0,
          status: parts[6] || 'OK'
        };
      }
      const rec = asRecord(item) ?? {};
      return {
        raw: toOptionalString(rec.raw) ?? '',
        timestamp: toOptionalString(rec.timestamp) ?? '',
        model: toOptionalString(rec.model) ?? '',
        provider: toOptionalString(rec.provider) ?? '',
        account: toOptionalString(rec.account) ?? '',
        inTokens: toNumber(rec.inTokens, 0),
        outTokens: toNumber(rec.outTokens, 0),
        status: toOptionalString(rec.status) ?? 'OK'
      };
    });
  } catch {
    return [];
  }
}

export function openConsoleLogStream(
  config: ExtensionConfig,
  auth: AuthContext,
  onEvent: (msg: ConsoleStreamMessage) => void,
  onError: (err: Error) => void
): () => void {
  let isAborted = false;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let activeReq: http.ClientRequest | undefined;
  const candidateTokens = getAllLocalCliTokens();
  let tokenIdx = 0;

  const connect = () => {
    if (isAborted) {
      return;
    }

    if (!auth.cliToken && candidateTokens.length > 0) {
      auth.cliToken = candidateTokens[tokenIdx];
    }

    let target: URL;
    try {
      target = buildUrl(config.baseUrl, '/api/translator/console-logs/stream');
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const client = target.protocol === 'http:' ? http : https;
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'User-Agent': 'vscode-9router-monitor-pro'
    };

    if (auth.authToken) {
      headers['Cookie'] = `auth_token=${auth.authToken}`;
    }
    if (auth.cliToken) {
      headers['x-9r-cli-token'] = auth.cliToken;
    }
    if (auth.legacyApiKey) {
      headers['Authorization'] = `Bearer ${auth.legacyApiKey}`;
      headers['x-api-key'] = auth.legacyApiKey;
    }

    if (activeReq) {
      activeReq.destroy();
      activeReq = undefined;
    }

    const req = client.request(
      target,
      {
        method: 'GET',
        headers
      },
      async (res) => {
        if (res.statusCode === 401) {
          res.resume();
          if (auth.password) {
            try {
              const newToken = await loginDashboard(auth.baseUrl, auth.password);
              auth.authToken = newToken;
              await auth.context.secrets.store(SECRET_SESSION_TOKEN, newToken);
              if (!isAborted) {
                connect();
              }
              return;
            } catch {
              // Re-login failed, continue to fallback candidate tokens
            }
          }

          if (tokenIdx + 1 < candidateTokens.length) {
            tokenIdx++;
            auth.cliToken = candidateTokens[tokenIdx];
            if (!isAborted) {
              connect();
            }
            return;
          }

          onError(
            new Error(
              'HTTP 401 Unauthorized: Vui lòng kiểm tra mật khẩu 9Router hoặc CLI token.'
            )
          );
          scheduleReconnect();
          return;
        }

        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          res.resume();
          onError(new Error(`SSE stream HTTP ${res.statusCode}`));
          scheduleReconnect();
          return;
        }

        if (res.statusCode === 200) {
          onEvent({ type: 'init', logs: [] });
        }

        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          try {
            buffer += chunk.toString('utf-8');
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data:')) {
                const jsonStr = trimmed.slice(5).trim();
                if (!jsonStr) {
                  continue;
                }
                try {
                  const parsed = JSON.parse(jsonStr) as ConsoleStreamMessage;
                  if (
                    parsed &&
                    typeof parsed === 'object' &&
                    'type' in parsed &&
                    ['init', 'line', 'lines', 'clear'].includes(parsed.type)
                  ) {
                    onEvent(parsed);
                  }
                } catch {
                  // Ignore parse errors for partial chunks
                }
              }
            }
          } catch {
            // Prevent crash on malformed chunks or encoding issues
          }
        });

        res.on('end', () => {
          if (!isAborted) {
            scheduleReconnect();
          }
        });

        res.on('close', () => {
          if (!isAborted) {
            scheduleReconnect();
          }
        });

        res.on('error', (err: Error) => {
          if (!isAborted) {
            onError(err);
            scheduleReconnect();
          }
        });
      }
    );

    req.on('error', (err: Error) => {
      if (!isAborted) {
        onError(err);
        scheduleReconnect();
      }
    });

    activeReq = req;
    req.end();
  };

  const scheduleReconnect = () => {
    if (isAborted || reconnectTimer) {
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, 3000);
  };

  connect();

  return () => {
    isAborted = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    if (activeReq) {
      activeReq.destroy();
      activeReq = undefined;
    }
  };
}

export async function clearServerConsoleLogs(
  config: ExtensionConfig,
  auth: AuthContext
): Promise<boolean> {
  try {
    const target = buildUrl(config.baseUrl, '/api/translator/console-logs');
    const res = await requestWithAuth(target, auth, { method: 'DELETE' });
    return res.status === 200;
  } catch {
    return false;
  }
}

