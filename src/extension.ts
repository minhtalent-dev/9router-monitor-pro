import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SECRET_PASSWORD = 'aiTokenUsage.dashboardPassword';
const SECRET_SESSION_TOKEN = 'aiTokenUsage.sessionToken';
const SECRET_API_KEY = 'aiTokenUsage.apiKey';

interface AuthContext {
  authToken?: string;
  password?: string;
  cliToken?: string;
  legacyApiKey?: string;
  baseUrl: string;
  context: vscode.ExtensionContext;
}

interface ProviderConnection {
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

interface QuotaData {
  used: number;
  total: number;
  remaining: number;
  resetAt?: string;
  unlimited: boolean;
}

interface UsageData {
  plan?: string;
  limitReached: boolean;
  reviewLimitReached: boolean;
  quotas: Record<string, QuotaData>;
}

interface ProviderUsage {
  connection: ProviderConnection;
  usage?: UsageData;
  error?: string;
  warning?: string;
}

interface DashboardData {
  items: ProviderUsage[];
  primary?: ProviderUsage;
  fetchedAt: Date;
}

interface ExtensionConfig {
  baseUrl: string;
  providersPath: string;
  usagePathTemplate: string;
  statusBarQuota: string;
  intervalSeconds: number;
}

const usageCache = new Map<string, UsageData>();

let statusBarItem: vscode.StatusBarItem;
let refreshTimer: NodeJS.Timeout | undefined;
let lastDashboard: DashboardData | undefined;
let lastError: string | undefined;
let detailsPanel: vscode.WebviewPanel | undefined;
let currentContext: vscode.ExtensionContext | undefined;

export function activate(context: vscode.ExtensionContext): void {
  currentContext = context;
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'aiTokenUsage.openQuickMenu';
  context.subscriptions.push(statusBarItem);
  statusBarItem.show();

  context.subscriptions.push(
    vscode.commands.registerCommand('aiTokenUsage.openQuickMenu', () =>
      openQuickMenu(context)
    ),
    vscode.commands.registerCommand('aiTokenUsage.refresh', () =>
      refresh(context)
    ),
    vscode.commands.registerCommand('aiTokenUsage.setConnection', () =>
      setConnection(context)
    ),
    vscode.commands.registerCommand('aiTokenUsage.setApiKey', () =>
      setApiKey(context)
    ),
    vscode.commands.registerCommand('aiTokenUsage.showDetails', () =>
      showDetails(context)
    ),
    vscode.commands.registerCommand('aiTokenUsage.setInterval', () =>
      setRefreshInterval()
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiTokenUsage.refreshIntervalSeconds')) {
        scheduleRefresh(context);
      }
      if (e.affectsConfiguration('aiTokenUsage')) {
        void refresh(context);
      }
    })
  );

  renderStatusBar();
  void refresh(context);
  scheduleRefresh(context);
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}

function getConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('aiTokenUsage');
  return {
    baseUrl: cfg.get<string>('apiBaseUrl', 'http://localhost:20128'),
    providersPath: cfg.get<string>(
      'providersPath',
      '/api/providers?page=1&pageSize=20&accountStatus=all&sort=priority&isActive=true'
    ),
    usagePathTemplate: cfg.get<string>('usagePathTemplate', '/api/usage/{id}'),
    statusBarQuota: cfg.get<string>('statusBarQuota', 'session'),
    intervalSeconds: Math.max(
      10,
      cfg.get<number>('refreshIntervalSeconds', 60)
    )
  };
}

function scheduleRefresh(context: vscode.ExtensionContext): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  const { intervalSeconds } = getConfig();
  refreshTimer = setInterval(() => {
    void refresh(context);
  }, intervalSeconds * 1000);
}

function getLocalCliToken(): string | null {
  const candidateDirs = [
    process.env.APPDATA ? path.join(process.env.APPDATA, '9router') : null,
    'C:\\Users\\Administrator\\AppData\\Roaming\\9router',
    path.join(os.homedir(), 'AppData', 'Roaming', '9router'),
    path.join(os.homedir(), '.9router')
  ].filter((dir): dir is string => Boolean(dir));

  for (const dir of candidateDirs) {
    try {
      const machineIdPath = path.join(dir, 'machine-id');
      const cliSecretPath1 = path.join(dir, 'auth', 'cli-secret');
      const cliSecretPath2 = path.join(dir, 'cli-secret');

      if (!fs.existsSync(machineIdPath)) {
        continue;
      }

      let secretPath: string | null = null;
      if (fs.existsSync(cliSecretPath1)) {
        secretPath = cliSecretPath1;
      } else if (fs.existsSync(cliSecretPath2)) {
        secretPath = cliSecretPath2;
      }

      if (!secretPath) {
        continue;
      }

      const machineId = fs.readFileSync(machineIdPath, 'utf-8').trim();
      const cliSecret = fs.readFileSync(secretPath, 'utf-8').trim();
      if (machineId && cliSecret) {
        return crypto
          .createHash('sha256')
          .update(machineId + '9r-cli-auth' + cliSecret)
          .digest('hex')
          .substring(0, 16);
      }
    } catch {
      // Ignore file read errors and continue checking other directories
    }
  }
  return null;
}

function loginDashboard(baseUrl: string, password: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let target: URL;
    try {
      target = buildUrl(baseUrl, '/api/auth/login');
    } catch (err) {
      reject(err);
      return;
    }

    const client = target.protocol === 'http:' ? http : https;
    const postData = JSON.stringify({ password });

    const req = client.request(
      target,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          Accept: 'application/json',
          'User-Agent': 'vscode-9router-monitor-pro'
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode ?? 0;

          if (status < 200 || status >= 300) {
            let detail = '';
            try {
              const parsed = JSON.parse(body) as { error?: string; message?: string };
              detail = parsed.error || parsed.message || '';
            } catch {
              detail = body.slice(0, 200);
            }
            const msg = detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
            if (status === 401) {
              reject(new Error(`Invalid Dashboard password (${msg})`));
            } else {
              reject(new Error(`Login failed (${msg})`));
            }
            return;
          }

          const setCookieHeader = res.headers['set-cookie'];
          let token: string | undefined;

          if (Array.isArray(setCookieHeader)) {
            for (const c of setCookieHeader) {
              const m = /auth_token=([^;]+)/.exec(c);
              if (m) {
                token = m[1];
                break;
              }
            }
          } else if (typeof setCookieHeader === 'string') {
            const m = /auth_token=([^;]+)/.exec(setCookieHeader);
            if (m) {
              token = m[1];
            }
          }

          if (!token) {
            try {
              const json = JSON.parse(body) as Record<string, unknown>;
              if (typeof json.token === 'string') {
                token = json.token;
              } else if (typeof json.authToken === 'string') {
                token = json.authToken;
              }
            } catch {
              // ignore parse errors
            }
          }

          if (token) {
            resolve(token);
          } else {
            reject(new Error('auth_token not found in login response.'));
          }
        });
      }
    );

    req.setTimeout(15000, () => {
      req.destroy(new Error('Login request timed out (15s).'));
    });
    req.on('error', (err) => reject(err));
    req.write(postData);
    req.end();
  });
}

async function setConnection(context: vscode.ExtensionContext): Promise<void> {
  const currentConfig = getConfig();
  const existingPassword = await context.secrets.get(SECRET_PASSWORD);

  // Step 1: Input Base URL
  const inputUrl = await vscode.window.showInputBox({
    title: '9Router Monitor Pro — Connection Setup (Step 1/2)',
    prompt:
      'Enter 9Router Base URL (Local: http://localhost:20128 or Cloudflare Tunnel: https://...)',
    value: currentConfig.baseUrl || 'http://localhost:20128',
    ignoreFocusOut: true,
    placeHolder: 'http://localhost:20128 or https://*.trycloudflare.com'
  });

  if (inputUrl === undefined) {
    return;
  }

  const cleanUrl = inputUrl.trim().replace(/\/+$/, '') || 'http://localhost:20128';

  // Step 2: Input Dashboard Password
  const inputPassword = await vscode.window.showInputBox({
    title: '9Router Monitor Pro — Dashboard Password (Step 2/2)',
    prompt:
      'Enter 9Router Dashboard Password. (Leave blank if running locally without password)',
    password: true,
    value: existingPassword ?? '',
    ignoreFocusOut: true,
    placeHolder: 'Dashboard password (default 123456 if unchanged)'
  });

  if (inputPassword === undefined) {
    return;
  }

  // Save Base URL to configuration
  const cfg = vscode.workspace.getConfiguration('aiTokenUsage');
  await cfg.update('apiBaseUrl', cleanUrl, vscode.ConfigurationTarget.Global);

  const trimmedPassword = inputPassword.trim();
  if (trimmedPassword !== '') {
    await context.secrets.store(SECRET_PASSWORD, trimmedPassword);
    try {
      const sessionToken = await loginDashboard(cleanUrl, trimmedPassword);
      await context.secrets.store(SECRET_SESSION_TOKEN, sessionToken);
      vscode.window.showInformationMessage('Successfully connected to 9Router!');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      vscode.window.showWarningMessage(
        `Saved Base URL, but authentication failed: ${errMsg} Please check password or Tunnel status.`
      );
    }
  } else {
    await context.secrets.delete(SECRET_PASSWORD);
    await context.secrets.delete(SECRET_SESSION_TOKEN);
    const cliToken = getLocalCliToken();
    if (cliToken) {
      vscode.window.showInformationMessage('Saved Base URL and local mode.');
    } else {
      vscode.window.showInformationMessage('Dashboard password removed.');
    }
  }

  await refresh(context);
}

async function setApiKey(context: vscode.ExtensionContext): Promise<void> {
  const existing = await context.secrets.get(SECRET_API_KEY);
  const value = await vscode.window.showInputBox({
    title: '9Router Monitor Pro — API Key',
    prompt: 'Enter your 9Router API key. Leave blank to delete saved key.',
    password: true,
    value: existing ?? '',
    ignoreFocusOut: true,
    placeHolder: 'sk-...'
  });

  if (value === undefined) {
    return;
  }

  if (value.trim() === '') {
    await context.secrets.delete(SECRET_API_KEY);
    vscode.window.showInformationMessage('API key cleared.');
  } else {
    await context.secrets.store(SECRET_API_KEY, value.trim());
    vscode.window.showInformationMessage('API key saved.');
  }
  await refresh(context);
}

interface IntervalPickItem extends vscode.QuickPickItem {
  seconds?: number;
  isCustom?: boolean;
}

async function setRefreshInterval(): Promise<void> {
  const currentInterval = getConfig().intervalSeconds;

  const items: IntervalPickItem[] = [
    {
      label: '15 seconds',
      description: '15s - High frequency',
      seconds: 15,
      picked: currentInterval === 15
    },
    {
      label: '30 seconds',
      description: '30s',
      seconds: 30,
      picked: currentInterval === 30
    },
    {
      label: '60 seconds (Default)',
      description: '60s - Recommended',
      seconds: 60,
      picked: currentInterval === 60
    },
    {
      label: '2 minutes',
      description: '120s',
      seconds: 120,
      picked: currentInterval === 120
    },
    {
      label: '5 minutes',
      description: '300s',
      seconds: 300,
      picked: currentInterval === 300
    },
    {
      label: 'Custom...',
      description: 'Custom interval in seconds (>= 10s)',
      isCustom: true
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: `9Router Monitor Pro — Auto-Refresh Interval (Current: ${currentInterval}s)`,
    placeHolder: 'Select auto-refresh interval'
  });

  if (!selected) {
    return;
  }

  let seconds: number | undefined;

  if (selected.isCustom) {
    const input = await vscode.window.showInputBox({
      title: '9Router Monitor Pro — Custom Refresh Interval',
      prompt: 'Enter refresh interval in seconds (minimum 10 seconds)',
      value: String(currentInterval),
      validateInput: (val) => {
        const num = Number(val);
        if (!Number.isInteger(num) || num < 10) {
          return 'Value must be an integer >= 10 seconds.';
        }
        return null;
      }
    });

    if (input === undefined) {
      return;
    }

    seconds = parseInt(input.trim(), 10);
  } else {
    seconds = selected.seconds;
  }

  if (seconds !== undefined && !Number.isNaN(seconds)) {
    const cfg = vscode.workspace.getConfiguration('aiTokenUsage');
    await cfg.update(
      'refreshIntervalSeconds',
      seconds,
      vscode.ConfigurationTarget.Global
    );
    vscode.window.showInformationMessage(
      `Auto-refresh interval set to ${seconds} seconds.`
    );
  }
}

async function refresh(context: vscode.ExtensionContext): Promise<void> {
  currentContext = context;
  const config = getConfig();
  const password = await context.secrets.get(SECRET_PASSWORD);
  const sessionToken = await context.secrets.get(SECRET_SESSION_TOKEN);
  const legacyApiKey = await context.secrets.get(SECRET_API_KEY);
  const localCliToken = getLocalCliToken() ?? undefined;

  if (!password && !sessionToken && !legacyApiKey && !localCliToken) {
    lastDashboard = undefined;
    lastError = undefined;
    renderStatusBar(true);
    return;
  }

  const auth: AuthContext = {
    authToken: sessionToken,
    password,
    cliToken: localCliToken,
    legacyApiKey,
    baseUrl: config.baseUrl,
    context
  };

  if (password && !auth.authToken) {
    try {
      auth.authToken = await loginDashboard(auth.baseUrl, password);
      await context.secrets.store(SECRET_SESSION_TOKEN, auth.authToken);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      lastDashboard = undefined;
      renderStatusBar();
      return;
    }
  }

  try {
    lastDashboard = await fetchDashboard(config, auth);
    lastError = undefined;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }
  renderStatusBar();
  if (detailsPanel && lastDashboard) {
    detailsPanel.webview.html = getWebviewContent(lastDashboard, context);
  }
}

async function mapConcurrent<T, R>(
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

async function fetchDashboard(
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

function buildUrl(baseUrl: string, pathOrUrl: string): URL {
  try {
    return new URL(pathOrUrl, baseUrl);
  } catch {
    throw new Error(`Invalid URL: ${baseUrl} + ${pathOrUrl}`);
  }
}

function buildUsagePath(template: string, providerId: string): string {
  if (template.includes('{id}')) {
    return template.replace(/\{id\}/g, encodeURIComponent(providerId));
  }
  const separator = template.endsWith('/') ? '' : '/';
  return `${template}${separator}${encodeURIComponent(providerId)}`;
}

function fetchJson(
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

async function getAuthContext(
  context: vscode.ExtensionContext
): Promise<AuthContext | undefined> {
  const config = getConfig();
  const password = await context.secrets.get(SECRET_PASSWORD);
  let sessionToken = await context.secrets.get(SECRET_SESSION_TOKEN);
  const legacyApiKey = await context.secrets.get(SECRET_API_KEY);
  const localCliToken = getLocalCliToken() ?? undefined;

  if (!password && !sessionToken && !legacyApiKey && !localCliToken) {
    return undefined;
  }

  if (password && !sessionToken) {
    try {
      sessionToken = await loginDashboard(config.baseUrl, password);
      await context.secrets.store(SECRET_SESSION_TOKEN, sessionToken);
    } catch {
      // Preliminary login error ignored
    }
  }

  return {
    authToken: sessionToken,
    password,
    cliToken: localCliToken,
    legacyApiKey,
    baseUrl: config.baseUrl,
    context
  };
}

function updateProviderActive(
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

function parseProviders(json: unknown): ProviderConnection[] {
  const root = asRecord(json);
  const rawConnections = Array.isArray(root?.connections)
    ? root.connections
    : [];

  return rawConnections
    .map((raw) => normalizeProvider(raw))
    .filter((provider): provider is ProviderConnection => provider !== undefined);
}

function normalizeProvider(raw: unknown): ProviderConnection | undefined {
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

function parseUsage(json: unknown): UsageData {
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

function normalizeQuota(raw: unknown): QuotaData {
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function toNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
  const n = toNumber(value, Number.NaN);
  return Number.isFinite(n) ? n : undefined;
}

function toOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return String(value);
}

function toBoolean(value: unknown, fallback: boolean): boolean {
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

function getPinnedAccountIds(context: vscode.ExtensionContext): string[] {
  const stored = context.globalState.get<string[]>('aiTokenUsage.pinnedAccountIds');
  if (Array.isArray(stored)) {
    return stored;
  }
  const oldSingle = context.globalState.get<string>('aiTokenUsage.pinnedAccountId');
  if (oldSingle) {
    const migrated = [oldSingle];
    void context.globalState.update('aiTokenUsage.pinnedAccountIds', migrated);
    void context.globalState.update('aiTokenUsage.pinnedAccountId', undefined);
    return migrated;
  }
  return [];
}

function getPinnedModels(context: vscode.ExtensionContext): string[] {
  const stored = context.globalState.get<string[]>('aiTokenUsage.pinnedModels');
  if (Array.isArray(stored)) {
    return stored;
  }
  const oldSingle = context.globalState.get<string>('aiTokenUsage.pinnedModel');
  if (oldSingle) {
    const migrated = [oldSingle];
    void context.globalState.update('aiTokenUsage.pinnedModels', migrated);
    void context.globalState.update('aiTokenUsage.pinnedModel', undefined);
    return migrated;
  }
  return [];
}

function renderStatusBar(missingKey = false): void {
  if (missingKey) {
    statusBarItem.text = '$(key) 9Router: Not Connected';
    statusBarItem.tooltip = 'Click to setup 9Router URL & Password.';
    statusBarItem.command = 'aiTokenUsage.setConnection';
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
    return;
  }

  statusBarItem.command = 'aiTokenUsage.openQuickMenu';

  if (lastError && !lastDashboard) {
    statusBarItem.text = '$(error) 9Router: Error';
    const errMd = new vscode.MarkdownString(undefined, true);
    errMd.isTrusted = true;
    errMd.appendMarkdown(`### $(error) 9Router: Error\n\n`);
    errMd.appendMarkdown(`> Failed to fetch data: ${lastError}\n\n`);
    errMd.appendMarkdown(
      `[$(gear) Setup Connection](command:aiTokenUsage.setConnection) &nbsp;│&nbsp; [$(refresh) Retry](command:aiTokenUsage.refresh)\n`
    );
    statusBarItem.tooltip = errMd;
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.errorBackground'
    );
    return;
  }

  if (!lastDashboard) {
    statusBarItem.text = '$(sync~spin) 9Router...';
    statusBarItem.tooltip = 'Loading providers and usage statistics...';
    statusBarItem.backgroundColor = undefined;
    return;
  }

  if (lastDashboard.items.length === 0) {
    statusBarItem.text = '$(warning) 9Router: No Providers';
    statusBarItem.tooltip = 'No active provider connections found.';
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
    return;
  }

  const pinnedAccountIds = currentContext
    ? getPinnedAccountIds(currentContext)
    : [];
  const pinnedModels = currentContext ? getPinnedModels(currentContext) : [];

  let displayItems: ProviderUsage[] = [];
  if (pinnedAccountIds.length > 0) {
    displayItems = lastDashboard.items.filter((it) =>
      pinnedAccountIds.includes(it.connection.id)
    );
  }
  if (displayItems.length === 0) {
    const fallback = lastDashboard.primary ?? lastDashboard.items[0];
    if (fallback) {
      displayItems = [fallback];
    }
  }

  if (displayItems.length === 0) {
    statusBarItem.text = '$(warning) 9Router: No Providers';
    statusBarItem.tooltip = 'No active provider connections found.';
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
    return;
  }

  const cfg = getConfig();
  let hasError = false;
  let hasWarning = false;

  for (const item of displayItems) {
    const { usage } = item;
    if (!usage || item.error || usage.limitReached) {
      hasError = true;
    } else {
      if (usage.reviewLimitReached) {
        hasWarning = true;
      }
      if (usage.quotas) {
        for (const q of Object.values(usage.quotas)) {
          if (getRemainingPercent(q) <= 15) {
            hasWarning = true;
          }
        }
      }
    }
  }

  let icon = '$(graph)';
  let bg: vscode.ThemeColor | undefined;
  if (hasError) {
    icon = '$(error)';
    bg = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (hasWarning) {
    icon = '$(warning)';
    bg = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  if (displayItems.length > 1) {
    const rawModels =
      pinnedModels.length > 0
        ? pinnedModels
        : [chooseQuotaName(displayItems[0].usage, cfg.statusBarQuota) ?? ''];
    const targetModels = rawModels.filter(Boolean);

    const aggParts: string[] = [];
    for (const m of targetModels) {
      let totalUsed = 0;
      let totalMax = 0;
      let totalRemaining = 0;
      let hasUnlimited = false;
      let found = false;
      let earliestReset: string | undefined;

      for (const item of displayItems) {
        const q = item.usage?.quotas?.[m];
        if (q) {
          found = true;
          totalUsed += q.used;
          totalMax += q.total;
          totalRemaining += q.remaining;
          if (q.unlimited) {
            hasUnlimited = true;
          }
          if (q.resetAt) {
            if (!earliestReset || new Date(q.resetAt).getTime() < new Date(earliestReset).getTime()) {
              earliestReset = q.resetAt;
            }
          }
        }
      }

      if (found) {
        const shortName = quotaShortName(m);
        const resetStr = formatResetCompact(earliestReset);
        const resetTag = resetStr ? ` (${resetStr})` : '';
        if (hasUnlimited) {
          aggParts.push(`${shortName} ∞${resetTag}`);
        } else {
          aggParts.push(
            `${shortName} ${formatCompact(totalRemaining)}/${formatCompact(totalMax)}${resetTag}`
          );
        }
      }
    }

    const modelsSummary = aggParts.length > 0 ? aggParts.join(' · ') : 'N/A';
    statusBarItem.text = `${icon} ⭐ ${displayItems.length} acc · ${modelsSummary}`;
  } else {
    const item = displayItems[0];
    const { connection, usage } = item;
    const isAccountPinned = pinnedAccountIds.includes(connection.id);
    const accName = truncateName(displayName(connection), 10);

    let targetModelKeys: string[] = [];
    if (pinnedModels.length > 0 && usage?.quotas) {
      targetModelKeys = pinnedModels.filter(
        (m) => usage.quotas[m] !== undefined
      );
    }

    if (targetModelKeys.length === 0) {
      const fallbackModel = chooseQuotaName(usage, cfg.statusBarQuota);
      if (fallbackModel && usage?.quotas && usage.quotas[fallbackModel]) {
        targetModelKeys = [fallbackModel];
      }
    }

    let modelsStr = 'N/A';
    if (usage?.quotas && targetModelKeys.length > 0) {
      modelsStr = targetModelKeys
        .map((key) => formatQuotaForStatus(key, usage.quotas[key]))
        .join(' · ');
    }

    statusBarItem.text = `${icon} ${isAccountPinned ? '⭐ ' : ''}${accName} · ${modelsStr}`;
  }

  statusBarItem.backgroundColor = bg;
  statusBarItem.tooltip = createDashboardTooltip(lastDashboard, displayItems);
}

function createDashboardTooltip(
  data: DashboardData,
  displayItems?: ProviderUsage[]
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  md.supportHtml = true;

  const pinnedAccountIds = currentContext
    ? getPinnedAccountIds(currentContext)
    : [];
  const pinnedModels = currentContext ? getPinnedModels(currentContext) : [];

  let targets = displayItems;
  if (!targets || targets.length === 0) {
    if (pinnedAccountIds.length > 0) {
      targets = data.items.filter((it) =>
        pinnedAccountIds.includes(it.connection.id)
      );
    }
    if (!targets || targets.length === 0) {
      targets = data.items.length > 0 ? [data.primary ?? data.items[0]] : [];
    }
  }

  if (targets.length === 0) {
    md.appendMarkdown('### $(graph) 9Router Monitor Pro\n\nNo active provider connections found.');
    return md;
  }

  md.appendMarkdown('### $(graph) 9Router Monitor Pro\n\n');
  if (lastError) {
    md.appendMarkdown(`> $(warning) Error: ${lastError}\n\n`);
  }

  const cfg = getConfig();

  if (targets.length > 1) {
    const rawModels =
      pinnedModels.length > 0
        ? pinnedModels
        : [chooseQuotaName(targets[0]?.usage, cfg.statusBarQuota) ?? ''];
    const modelsToTrack = rawModels.filter(Boolean);

    // Aggregate Summary
    md.appendMarkdown('**Aggregate Summary**\n\n');
    md.appendMarkdown('| Model | Remaining / Total | Used | Reset | Progress |\n');
    md.appendMarkdown('|:---|:---:|:---:|:---:|:---:|\n');

    for (const m of modelsToTrack) {
      let totalUsed = 0;
      let totalMax = 0;
      let totalRemaining = 0;
      let hasUnlimited = false;
      let earliestReset: string | undefined;

      for (const t of targets) {
        const q = t.usage?.quotas?.[m];
        if (q) {
          totalUsed += q.used;
          totalMax += q.total;
          totalRemaining += q.remaining;
          if (q.unlimited) {
            hasUnlimited = true;
          }
          if (q.resetAt) {
            if (!earliestReset || new Date(q.resetAt).getTime() < new Date(earliestReset).getTime()) {
              earliestReset = q.resetAt;
            }
          }
        }
      }

      const usedPct =
        hasUnlimited || totalMax <= 0
          ? 0
          : Math.min(100, Math.max(0, (totalUsed / totalMax) * 100));
      const remPct =
        hasUnlimited
          ? 100
          : totalMax <= 0
            ? 0
            : Math.min(100, Math.max(0, (totalRemaining / totalMax) * 100));
      const remStr = hasUnlimited ? '∞' : formatCompact(totalRemaining);
      const maxStr = hasUnlimited ? '∞' : formatCompact(totalMax);
      const pctStr = hasUnlimited ? 'N/A' : `${usedPct.toFixed(1)}%`;
      const healthIcon = hasUnlimited ? '🟢' : getHealthIcon(remPct);
      const barStr = hasUnlimited ? '—' : `${healthIcon} ${renderTextBar(usedPct, 8)}`;
      const resetCol = formatResetCompact(earliestReset) || '—';

      md.appendMarkdown(
        `| **${quotaTitle(m)}** | ${remStr} / ${maxStr} | ${pctStr} | ${resetCol} | ${barStr} |\n`
      );
    }
    md.appendMarkdown('\n');

    // Account Details
    md.appendMarkdown('**Account Details**\n\n');
    const modelHeaders = modelsToTrack.map((m) => quotaTitle(m));
    const headerCols = ['#', 'Account', ...modelHeaders, 'Status'];
    const alignCols = [':--', ':---', ...modelsToTrack.map(() => ':---:'), ':---:'];
    md.appendMarkdown(`| ${headerCols.join(' | ')} |\n`);
    md.appendMarkdown(`| ${alignCols.join(' | ')} |\n`);

    for (const t of targets) {
      const conn = t.connection;
      const isPinnedAcc = pinnedAccountIds.includes(conn.id);
      const accNum = `${isPinnedAcc ? '⭐' : ''}#${conn.priority}`;
      const accName = truncateName(displayName(conn), 12);
      const statusIcon = conn.isActive ? '✓ Active' : '✗ Inactive';

      const modelCols = modelsToTrack.map((m) => {
        const q = t.usage?.quotas?.[m];
        if (!q) {
          return '-';
        }
        if (q.unlimited) {
          return '**∞** / ∞';
        }
        const rem = formatCompact(q.remaining);
        const tot = formatCompact(q.total);
        const pct = Math.round(getUsedPercent(q));
        return `**${rem}** / ${tot} (${pct}%)`;
      });

      md.appendMarkdown(
        `| ${accNum} | ${accName} | ${modelCols.join(' | ')} | ${statusIcon} |\n`
      );
    }
    md.appendMarkdown('\n');
  } else {
    // targets.length === 1
    const target = targets[0];
    const conn = target.connection;
    const isPinnedAcc = pinnedAccountIds.includes(conn.id);
    const nameLabel = displayName(conn);
    const plan = target.usage?.plan ?? connectionPlan(conn) ?? 'Standard';
    const statusText = conn.isActive ? '✓ Active' : '✗ Inactive';

    md.appendMarkdown(
      `**${isPinnedAcc ? '⭐ ' : ''}${nameLabel}** (\`#${conn.priority}\`) · \`${conn.provider}\` · \`${statusText}\` · \`${plan}\`\n\n`
    );

    const quotas = target.usage?.quotas ?? {};
    let singleModels = pinnedModels.filter((m) => quotas[m] !== undefined);
    if (singleModels.length === 0) {
      const activeEntries = Object.entries(quotas)
        .filter(([, q]) => q.used > 0)
        .sort((a, b) => b[1].used - a[1].used)
        .map(([k]) => k);
      singleModels =
        activeEntries.length > 0
          ? activeEntries.slice(0, 5)
          : Object.keys(quotas).slice(0, 3);
    }

    if (singleModels.length > 0) {
      md.appendMarkdown('| Model | Remaining / Total | Used | Reset | Progress |\n');
      md.appendMarkdown('|:---|:---:|:---:|:---:|:---:|\n');

      for (const m of singleModels) {
        const q = quotas[m];
        const isPinnedModel = pinnedModels.includes(m);
        const usedPct = getUsedPercent(q);
        const remPct = getRemainingPercent(q);
        const rem = q.unlimited ? '∞' : formatCompact(q.remaining);
        const tot = q.unlimited ? '∞' : formatCompact(q.total);
        const pctStr = q.unlimited ? 'N/A' : `${usedPct.toFixed(1)}%`;
        const healthIcon = q.unlimited ? '🟢' : getHealthIcon(remPct);
        const barStr = q.unlimited ? '—' : `${healthIcon} ${renderTextBar(usedPct, 8)}`;
        const modelTitle = `${isPinnedModel ? '⭐ ' : ''}${quotaTitle(m)}`;
        const resetCol = formatResetCompact(q.resetAt) || '—';

        md.appendMarkdown(
          `| ${modelTitle} | **${rem}** / ${tot} | ${pctStr} | ${resetCol} | ${barStr} |\n`
        );
      }
      md.appendMarkdown('\n');
    } else {
      md.appendMarkdown('*No quota information available.*\n\n');
    }
  }

  md.appendMarkdown(
    '---\n\n👉 [Open Quick Menu](command:aiTokenUsage.openQuickMenu) &nbsp;│&nbsp; [Open Dashboard Webview](command:aiTokenUsage.showDetails)\n'
  );

  return md;
}

async function openQuickMenu(context: vscode.ExtensionContext): Promise<void> {
  if (!lastDashboard) {
    await refresh(context);
  }

  interface QuickMenuItem extends vscode.QuickPickItem {
    action: string;
  }

  const pinnedAccountIds = getPinnedAccountIds(context);
  const pinnedModels = getPinnedModels(context);
  const cfg = getConfig();

  const items: QuickMenuItem[] = [
    {
      label: '$(star) Pin / Unpin Accounts on Status Bar...',
      description: `Current: ${pinnedAccountIds.length} account(s) pinned`,
      detail: 'Select one or multiple accounts to pin and aggregate on status bar',
      action: 'pinAccount'
    },
    {
      label: '$(symbol-event) Pin / Unpin Models on Status Bar...',
      description: `Current: ${pinnedModels.length} model(s) pinned`,
      detail: 'Select one or multiple models to pin on status bar',
      action: 'pinModel'
    },
    {
      label: '$(zap) Enable / Disable Accounts...',
      description: 'Active / Inactive',
      detail: 'Toggle provider account active status in 9Router',
      action: 'toggleAccount'
    },
    {
      label: '$(dashboard) Open Full Webview Dashboard',
      description: 'Full accounts & models overview',
      detail: 'View interactive matrix, multi-filter, search, and sort',
      action: 'openDashboard'
    },
    {
      label: '$(refresh) Refresh Data',
      description: 'Fetch latest quota from 9Router',
      detail: 'Fetch latest quota and provider stats immediately',
      action: 'refresh'
    },
    {
      label: `$(clock) Set Refresh Interval (${cfg.intervalSeconds}s)...`,
      description: 'Configure auto-refresh frequency (15s, 30s, 60s, custom)',
      action: 'setInterval'
    },
    {
      label: '$(gear) Setup Connection (URL & Password)',
      description: cfg.baseUrl,
      detail: 'Reconfigure Base URL, Password, or switch to Local CLI Token',
      action: 'setConnection'
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: '⭐ 9Router Monitor Pro — Quick Menu',
    placeHolder: 'Select a quick action or open Dashboard',
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (!selected) {
    return;
  }

  switch (selected.action) {
    case 'pinAccount':
      await showPinAccountQuickPick(context);
      break;
    case 'pinModel':
      await showPinModelQuickPick(context);
      break;
    case 'toggleAccount':
      await showToggleAccountQuickPick(context);
      break;
    case 'openDashboard':
      await showDetails(context);
      break;
    case 'refresh':
      await refresh(context);
      vscode.window.showInformationMessage('9Router data refreshed.');
      break;
    case 'setInterval':
      await setRefreshInterval();
      break;
    case 'setConnection':
      await setConnection(context);
      break;
  }
}

async function showPinAccountQuickPick(
  context: vscode.ExtensionContext
): Promise<void> {
  if (!lastDashboard || lastDashboard.items.length === 0) {
    vscode.window.showWarningMessage('No accounts available.');
    return;
  }
  const pinnedAccountIds = getPinnedAccountIds(context);

  interface AccountPickItem extends vscode.QuickPickItem {
    accountId: string;
  }

  const pickItems: AccountPickItem[] = lastDashboard.items.map((item) => {
    const conn = item.connection;
    const isPinned = pinnedAccountIds.includes(conn.id);
    const isPrimary = conn.priority === 1;
    const statusIcon = conn.isActive ? '✓' : '✗';
    const plan = item.usage?.plan ?? connectionPlan(conn) ?? 'Standard';

    return {
      label: `${isPinned ? '$(star-full) ' : '$(star-empty) '}${displayName(conn)}`,
      description: `[${conn.provider}] #${conn.priority} · ${statusIcon} · ${plan}${
        isPrimary ? ' (Priority 1)' : ''
      }`,
      detail: `ID: ${conn.id}`,
      accountId: conn.id,
      picked: isPinned
    };
  });

  const selected = await vscode.window.showQuickPick(pickItems, {
    canPickMany: true,
    title: 'Select Accounts to Pin on Status Bar',
    placeHolder: 'Check accounts to pin on Status Bar',
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (selected === undefined) {
    return;
  }

  const newPinnedIds = selected.map((s) => s.accountId);
  await context.globalState.update(
    'aiTokenUsage.pinnedAccountIds',
    newPinnedIds
  );

  renderStatusBar();
  if (detailsPanel && lastDashboard) {
    detailsPanel.webview.html = getWebviewContent(lastDashboard, context);
  }
  vscode.window.showInformationMessage(
    `Updated ${selected.length} pinned account(s) on Status Bar.`
  );
}

async function showPinModelQuickPick(
  context: vscode.ExtensionContext
): Promise<void> {
  if (!lastDashboard || lastDashboard.items.length === 0) {
    vscode.window.showWarningMessage('No accounts available.');
    return;
  }

  const pinnedModels = getPinnedModels(context);

  const modelKeysMap = new Map<string, { title: string; usageSummary?: string }>();
  for (const it of lastDashboard.items) {
    if (it.usage?.quotas) {
      for (const [key, quota] of Object.entries(it.usage.quotas)) {
        if (!modelKeysMap.has(key)) {
          const usedPct = getUsedPercent(quota);
          const rem = quota.unlimited ? '∞' : formatCompact(quota.remaining);
          const tot = quota.unlimited ? '∞' : formatCompact(quota.total);
          modelKeysMap.set(key, {
            title: quotaTitle(key),
            usageSummary: `${quota.used}/${tot} (${usedPct.toFixed(1)}%) · Rem: ${rem}`
          });
        }
      }
    }
  }

  if (modelKeysMap.size === 0) {
    vscode.window.showWarningMessage('No models found across accounts.');
    return;
  }

  interface ModelPickItem extends vscode.QuickPickItem {
    modelKey: string;
  }

  const pickItems: ModelPickItem[] = Array.from(modelKeysMap.entries()).map(
    ([key, info]) => {
      const isPinned = pinnedModels.includes(key);
      return {
        label: `${isPinned ? '$(star-full) ' : '$(star-empty) '}${info.title}`,
        description: `Key: ${key}${info.usageSummary ? ` · ${info.usageSummary}` : ''}`,
        modelKey: key,
        picked: isPinned
      };
    }
  );

  const selected = await vscode.window.showQuickPick(pickItems, {
    canPickMany: true,
    title: 'Select Models to Pin on Status Bar',
    placeHolder: 'Check models to pin on Status Bar',
    matchOnDescription: true
  });

  if (selected === undefined) {
    return;
  }

  const newPinnedModels = selected.map((s) => s.modelKey);
  await context.globalState.update('aiTokenUsage.pinnedModels', newPinnedModels);

  renderStatusBar();
  if (detailsPanel && lastDashboard) {
    detailsPanel.webview.html = getWebviewContent(lastDashboard, context);
  }
  vscode.window.showInformationMessage(
    `Updated ${selected.length} pinned model(s) on Status Bar.`
  );
}

async function showToggleAccountQuickPick(
  context: vscode.ExtensionContext
): Promise<void> {
  if (!lastDashboard || lastDashboard.items.length === 0) {
    vscode.window.showWarningMessage('No accounts available.');
    return;
  }

  interface TogglePickItem extends vscode.QuickPickItem {
    connectionId: string;
    currentActive: boolean;
    name: string;
  }

  const pickItems: TogglePickItem[] = lastDashboard.items.map((it) => {
    const conn = it.connection;
    const name = displayName(conn);
    return {
      label: `${conn.isActive ? '$(check) ' : '$(circle-slash) '}${name}`,
      description: `[${conn.provider}] #${conn.priority} — Status: ${
        conn.isActive ? 'Active' : 'Inactive'
      }`,
      detail: `Click to ${conn.isActive ? 'Disable' : 'Enable'} this account`,
      connectionId: conn.id,
      currentActive: conn.isActive,
      name
    };
  });

  const picked = await vscode.window.showQuickPick(pickItems, {
    title: 'Select an Account to Toggle Active / Inactive',
    placeHolder: 'Select an Account to Toggle Active / Inactive',
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (!picked) {
    return;
  }

  const auth = await getAuthContext(context);
  if (!auth) {
    vscode.window.showErrorMessage(
      'No authentication credentials found to connect to 9Router.'
    );
    return;
  }

  const newActive = !picked.currentActive;
  try {
    await updateProviderActive(auth, picked.connectionId, newActive);
    vscode.window.showInformationMessage(
      `Account ${picked.name} is now ${newActive ? 'Active' : 'Inactive'}.`
    );
    await refresh(context);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to update account status: ${errMsg}`);
  }
}

async function showDetails(context: vscode.ExtensionContext): Promise<void> {
  const password = await context.secrets.get(SECRET_PASSWORD);
  const sessionToken = await context.secrets.get(SECRET_SESSION_TOKEN);
  const apiKey = await context.secrets.get(SECRET_API_KEY);
  const cliToken = getLocalCliToken();

  if (!password && !sessionToken && !apiKey && !cliToken) {
    const pick = await vscode.window.showWarningMessage(
      '9Router connection is not configured.',
      'Configure Now'
    );
    if (pick === 'Configure Now') {
      await setConnection(context);
    }
    return;
  }

  if (!lastDashboard) {
    await refresh(context);
  }

  if (lastError && !lastDashboard) {
    const pick = await vscode.window.showErrorMessage(
      `9Router Monitor Pro: ${lastError}`,
      'Retry',
      'Change Connection'
    );
    if (pick === 'Retry') {
      await refresh(context);
    } else if (pick === 'Change Connection') {
      await setConnection(context);
    }
    return;
  }

  if (!lastDashboard) {
    return;
  }

  if (detailsPanel) {
    detailsPanel.webview.html = getWebviewContent(lastDashboard, context);
    detailsPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  detailsPanel = vscode.window.createWebviewPanel(
    'aiTokenUsage.dashboard',
    '9Router Monitor Pro',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  detailsPanel.webview.html = getWebviewContent(lastDashboard, context);

  detailsPanel.webview.onDidReceiveMessage(
    async (msg: {
      command: string;
      model?: string;
      modelName?: string;
      sort?: string;
      filter?: string;
      accountId?: string;
      connectionId?: string;
      newActive?: boolean;
    }) => {
      if (msg.command === 'refresh') {
        await refresh(context);
        if (lastDashboard && detailsPanel) {
          detailsPanel.webview.html = getWebviewContent(lastDashboard, context);
        }
      } else if (msg.command === 'setConnection') {
        await setConnection(context);
        if (lastDashboard && detailsPanel) {
          detailsPanel.webview.html = getWebviewContent(lastDashboard, context);
        }
      } else if (msg.command === 'changeApiKey') {
        await setApiKey(context);
        if (lastDashboard && detailsPanel) {
          detailsPanel.webview.html = getWebviewContent(lastDashboard, context);
        }
      } else if (
        (msg.command === 'togglePinAccount' || msg.command === 'pinAccount') &&
        msg.accountId
      ) {
        let pinnedAccountIds = getPinnedAccountIds(context);
        if (pinnedAccountIds.includes(msg.accountId)) {
          pinnedAccountIds = pinnedAccountIds.filter((id) => id !== msg.accountId);
          vscode.window.showInformationMessage(
            'Unpinned account from Status Bar.'
          );
        } else {
          pinnedAccountIds = [...pinnedAccountIds, msg.accountId];
          const conn = lastDashboard?.items.find(
            (it) => it.connection.id === msg.accountId
          )?.connection;
          vscode.window.showInformationMessage(
            `Pinned ${
              conn ? displayName(conn) : msg.accountId
            } to Status Bar.`
          );
        }
        await context.globalState.update(
          'aiTokenUsage.pinnedAccountIds',
          pinnedAccountIds
        );
        renderStatusBar();
        if (lastDashboard && detailsPanel) {
          detailsPanel.webview.html = getWebviewContent(lastDashboard, context);
        }
      } else if (
        msg.command === 'toggleProviderActive' &&
        msg.connectionId !== undefined
      ) {
        const auth = await getAuthContext(context);
        if (!auth) {
          vscode.window.showErrorMessage(
            'No authentication credentials found to connect to 9Router.'
          );
          return;
        }
        try {
          await updateProviderActive(
            auth,
            msg.connectionId,
            Boolean(msg.newActive)
          );
          const conn = lastDashboard?.items.find(
            (it) => it.connection.id === msg.connectionId
          )?.connection;
          const name = conn ? displayName(conn) : msg.connectionId;
          vscode.window.showInformationMessage(
            `Account ${name} is now ${msg.newActive ? 'Active' : 'Inactive'}.`
          );
          await refresh(context);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Failed to update account status: ${errMsg}`
          );
        }
      } else if (
        (msg.command === 'togglePinModel' || msg.command === 'pinModel') &&
        (msg.modelName || msg.model)
      ) {
        const modelKey = msg.modelName || msg.model!;
        let pinnedModels = getPinnedModels(context);
        if (pinnedModels.includes(modelKey)) {
          pinnedModels = pinnedModels.filter((m) => m !== modelKey);
          vscode.window.showInformationMessage(
            `Unpinned ${quotaTitle(modelKey)} from Status Bar.`
          );
        } else {
          pinnedModels = [...pinnedModels, modelKey];
          vscode.window.showInformationMessage(
            `Pinned ${quotaTitle(modelKey)} to Status Bar.`
          );
        }
        await context.globalState.update(
          'aiTokenUsage.pinnedModels',
          pinnedModels
        );
        renderStatusBar();
        if (lastDashboard && detailsPanel) {
          detailsPanel.webview.html = getWebviewContent(lastDashboard, context);
        }
      } else if (msg.command === 'toggleHide' && msg.model) {
        const hidden =
          context.globalState.get<string[]>('aiTokenUsage.hiddenModels') ?? [];
        let updated: string[];
        if (hidden.includes(msg.model)) {
          updated = hidden.filter((m) => m !== msg.model);
          vscode.window.showInformationMessage(`Model ${msg.model} unhidden.`);
        } else {
          updated = [...hidden, msg.model];
          vscode.window.showInformationMessage(`Model ${msg.model} hidden.`);
        }
        await context.globalState.update('aiTokenUsage.hiddenModels', updated);
        if (lastDashboard && detailsPanel) {
          detailsPanel.webview.html = getWebviewContent(lastDashboard, context);
        }
      } else if (msg.command === 'updateSort' && msg.sort) {
        await context.globalState.update('aiTokenUsage.preferredSort', msg.sort);
      } else if (msg.command === 'updateFilter' && msg.filter) {
        await context.globalState.update(
          'aiTokenUsage.preferredFilter',
          msg.filter
        );
      }
    },
    undefined,
    context.subscriptions
  );

  detailsPanel.onDidDispose(
    () => {
      detailsPanel = undefined;
    },
    undefined,
    context.subscriptions
  );
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getWebviewContent(
  data: DashboardData,
  context: vscode.ExtensionContext,
  pinnedAccountIds = getPinnedAccountIds(context),
  pinnedModels = getPinnedModels(context)
): string {
  const cfg = getConfig();
  const hiddenModels =
    context.globalState.get<string[]>('aiTokenUsage.hiddenModels') ?? [];
  const preferredSort =
    context.globalState.get<string>('aiTokenUsage.preferredSort') ??
    'used_desc';
  const preferredFilter =
    context.globalState.get<string>('aiTokenUsage.preferredFilter') ?? 'all';

  const providerSet = new Set<string>();
  for (const it of data.items) {
    if (it.connection.provider) {
      providerSet.add(it.connection.provider);
    }
  }
  const uniqueProviders = Array.from(providerSet).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  let sectionsHtml = '';

  for (const item of data.items) {
    const { connection, usage } = item;
    const isPrimary = connection.priority === 1;
    const isPinnedAcc = pinnedAccountIds.includes(connection.id);
    const nameLabel = escHtml(displayName(connection));
    const plan = usage?.plan ?? connectionPlan(connection);

    let badgesHtml = `<span class="badge priority">#${connection.priority}</span>`;
    badgesHtml += `<span class="badge provider">${escHtml(connection.provider)}</span>`;
    if (connection.authType) {
      badgesHtml += `<span class="badge">${escHtml(connection.authType)}</span>`;
    }
    if (plan) {
      badgesHtml += `<span class="badge plan">${escHtml(plan)}</span>`;
    }

    const pinAccountBtnHtml = isPinnedAcc
      ? `<button class="pinned-account-btn active" data-account-id="${escHtml(
          connection.id
        )}" title="Unpin account from Status Bar">★ Pinned</button>`
      : `<button class="pinned-account-btn" data-account-id="${escHtml(
          connection.id
        )}" title="Pin account to Status Bar">☆ Pin Account</button>`;

    const toggleBtnHtml = connection.isActive
      ? `<button class="toggle-btn active" data-connection-id="${escHtml(
          connection.id
        )}" data-active="true" title="Click to disable this account">✓ Active</button>`
      : `<button class="toggle-btn inactive" data-connection-id="${escHtml(
          connection.id
        )}" data-active="false" title="Click to enable this account">✗ Inactive</button>`;

    let bodyHtml = '';
    if (item.error) {
      bodyHtml = `<div class="error-msg">⚠ Error: ${escHtml(item.error)}</div>`;
    } else if (!usage) {
      bodyHtml = '<div class="no-data">No usage data available</div>';
    } else {
      let alertsHtml = '';
      if (item.warning) {
        alertsHtml += `<div class="limit-alert review" style="margin-bottom:8px;">⏱️ ${escHtml(item.warning)}</div>`;
      }
      if (usage.limitReached) {
        alertsHtml += '<div class="limit-alert limit">🔴 LIMIT REACHED!</div>';
      }
      if (usage.reviewLimitReached) {
        alertsHtml +=
          '<div class="limit-alert review">🟡 Review Limit Reached</div>';
      }

      let cardsHtml = '';
      const quotasList = Object.entries(usage.quotas);

      for (const [name, quota] of quotasList) {
        const isPinned = pinnedModels.includes(name);
        const isHidden = hiddenModels.includes(name);
        const usedPct = getUsedPercent(quota);
        const remPct = getRemainingPercent(quota);
        const title = quotaTitle(name);
        const raw = name;
        const resetMs = quota.resetAt
          ? new Date(quota.resetAt).getTime() || 0
          : 0;

        let barColor = 'var(--green)';
        if (usedPct >= 95) {
          barColor = 'var(--red)';
        } else if (usedPct >= 85) {
          barColor = 'var(--yellow)';
        }

        const resetText = quota.resetAt
          ? `🔄 Reset: ${escHtml(formatDate(quota.resetAt))}`
          : quota.unlimited
          ? 'Unlimited'
          : '';

        cardsHtml += `
          <div class="model-card${isPinned ? ' is-pinned' : ''}${
          isHidden ? ' is-hidden' : ''
        }"
               data-model="${escHtml(raw.toLowerCase())}"
               data-title="${escHtml(title.toLowerCase())}"
               data-used="${quota.used}"
               data-total="${quota.total}"
               data-pct="${usedPct}"
               data-remaining="${quota.remaining}"
               data-reset="${resetMs}"
               data-hidden="${isHidden ? 'true' : 'false'}"
               data-pinned="${isPinned ? 'true' : 'false'}">
            <div class="card-top">
              <div class="model-info">
                <div class="model-title" title="${escHtml(title)}">${escHtml(
          title
        )}</div>
                <div class="model-raw" title="${escHtml(raw)}">${escHtml(
          raw
        )}</div>
              </div>
              <div class="card-actions">
                ${isPinned ? '<span class="badge-pinned">⭐ Pinned</span>' : ''}
                ${isHidden ? '<span class="badge-hidden">Hidden</span>' : ''}
                <button class="btn-icon star-btn${
                  isPinned ? ' active' : ''
                }" data-model="${escHtml(
          raw
        )}" title="${isPinned ? 'Unpin from Status Bar' : 'Pin to Status Bar'}">⭐</button>
                <button class="btn-icon hide-btn${
                  isHidden ? ' active' : ''
                }" data-model="${escHtml(
          raw
        )}" title="${isHidden ? 'Unhide model' : 'Hide model'}">${isHidden ? '🙈' : '👁️'}</button>
              </div>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width:${usedPct}%;background:${barColor};"></div>
            </div>
            <div class="model-stats">
              <span class="stat-used">${formatCompact(quota.used)} / ${
          quota.unlimited ? '∞' : formatCompact(quota.total)
        } used</span>
              <span class="stat-pct" style="color:${barColor};">${usedPct.toFixed(
          1
        )}%</span>
            </div>
            <div class="model-sub">
              <span class="stat-rem">Remaining: <strong>${
                quota.unlimited ? '∞' : formatCompact(quota.remaining)
              }</strong> (${remPct.toFixed(1)}%)</span>
              <span class="reset-time">${resetText}</span>
            </div>
          </div>`;
      }

      bodyHtml = `
        ${alertsHtml}
        <div class="models-grid">
          ${cardsHtml}
        </div>
        <div class="empty-grid-notice" style="display:none;">No models match current filter.</div>`;
    }

    let tsHtml = '';
    const tsItems: string[] = [];
    if (connection.lastUsedAt) {
      tsItems.push(
        `<span>🕐 Last used: <strong>${escHtml(
          formatDate(connection.lastUsedAt)
        )}</strong></span>`
      );
    }
    if (connection.lastRefreshAt) {
      tsItems.push(
        `<span>🔄 Refresh: <strong>${escHtml(
          formatDate(connection.lastRefreshAt)
        )}</strong></span>`
      );
    }
    if (connection.expiresAt) {
      tsItems.push(
        `<span>📅 Expires: <strong>${escHtml(
          formatDate(connection.expiresAt)
        )}</strong></span>`
      );
    }
    if (tsItems.length > 0) {
      tsHtml = `<div class="timestamps">${tsItems.join(
        '<span class="ts-sep">│</span>'
      )}</div>`;
    }

    sectionsHtml += `
      <div class="provider-section${isPrimary ? ' primary' : ''}${
      isPinnedAcc ? ' pinned-account' : ''
    }"
           data-provider="${escHtml(connection.provider.toLowerCase())}"
           data-name="${escHtml(displayName(connection).toLowerCase())}"
           data-priority="${connection.priority}">
        <div class="provider-header">
          <div class="provider-title">
            <span class="star">${isPinnedAcc ? '⭐' : isPrimary ? '📌' : '👤'}</span>
            <span class="name">${nameLabel}</span>
          </div>
          <div class="provider-header-actions">
            ${pinAccountBtnHtml}
            ${toggleBtnHtml}
            <div class="badges">${badgesHtml}</div>
          </div>
        </div>
        <div class="provider-body">
          ${bodyHtml}
        </div>
        ${tsHtml}
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: #0d1117;
    --card-bg: #161b22;
    --card-border: #30363d;
    --card-primary-border: #1f6feb;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --text-dim: #6e7681;
    --green: #3fb950;
    --yellow: #d29922;
    --red: #f85149;
    --blue: #58a6ff;
    --track: #21262d;
    --btn-hover: #30363d;
    --radius: 8px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    padding: 20px;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--card-border);
    gap: 12px;
    flex-wrap: wrap;
  }
  .header-left h1 {
    font-size: 20px;
    font-weight: 600;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .header-left .updated {
    color: var(--text-muted);
    font-size: 12px;
    margin-top: 2px;
  }
  .header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn {
    border: 1px solid var(--card-border);
    background: var(--card-bg);
    color: var(--text);
    padding: 6px 14px;
    border-radius: var(--radius);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn:hover {
    background: var(--btn-hover);
    border-color: #8b949e;
  }
  .btn-primary {
    background: #238636;
    border-color: #2ea043;
    color: #ffffff;
  }
  .btn-primary:hover {
    background: #2ea043;
    border-color: #3fb950;
  }

  /* Toolbar */
  .toolbar {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius);
    padding: 12px 16px;
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .toolbar-row-top {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  .search-box {
    flex: 1;
    min-width: 240px;
  }
  .search-box input {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text);
    padding: 8px 12px;
    border-radius: var(--radius);
    font-size: 13px;
    outline: none;
    transition: border-color 0.2s ease;
  }
  .search-box input:focus {
    border-color: var(--blue);
  }
  .sort-box select {
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text);
    padding: 8px 12px;
    border-radius: var(--radius);
    font-size: 13px;
    outline: none;
    cursor: pointer;
  }
  .sort-box select:focus {
    border-color: var(--blue);
  }
  .toolbar-row-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .filter-chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .filter-chip {
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  }
  .filter-chip:hover {
    color: var(--text);
    border-color: var(--text-muted);
  }
  .filter-chip.active {
    background: #1f6feb;
    border-color: #388bfd;
    color: #ffffff;
    font-weight: 500;
  }
  .show-hidden-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
    user-select: none;
  }
  .show-hidden-toggle input {
    cursor: pointer;
  }

  /* Provider Section */
  .provider-section {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius);
    padding: 16px;
    margin-bottom: 16px;
    transition: border-color 0.15s ease;
  }
  .provider-section.primary { border-color: var(--card-primary-border); }
  .provider-section.pinned-account {
    border-color: #855b14;
    box-shadow: 0 0 10px rgba(227, 179, 65, 0.12);
  }
  .provider-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--card-border);
  }
  .provider-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 600;
  }
  .provider-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .pinned-account-btn, .pin-account-btn {
    border: 1px solid var(--card-border);
    background: var(--bg);
    color: var(--text-muted);
    border-radius: 14px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .pinned-account-btn:hover, .pin-account-btn:hover {
    background: var(--btn-hover);
    color: var(--text);
    border-color: #8b949e;
  }
  .pinned-account-btn.active, .pin-account-btn.active {
    background: #2b2310;
    border-color: #855b14;
    color: #e3b341;
  }
  .toggle-btn {
    border: 1px solid var(--card-border);
    border-radius: 14px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .toggle-btn.active {
    background: #0d2818;
    border-color: #1b4721;
    color: var(--green);
  }
  .toggle-btn.active:hover {
    background: #1b4721;
    border-color: #2ea043;
  }
  .toggle-btn.inactive {
    background: #2d1111;
    border-color: #5a1e1e;
    color: var(--red);
  }
  .toggle-btn.inactive:hover {
    background: #5a1e1e;
    border-color: #f85149;
  }
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .badge {
    display: inline-block;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 12px;
    background: #21262d;
    color: var(--text-muted);
    border: 1px solid var(--card-border);
  }
  .badge.priority { color: var(--blue); border-color: #1f4470; background: #0d1f3c; }
  .badge.plan { color: #d2a8ff; border-color: #3d2960; background: #1c1236; }
  .badge.provider { color: #58a6ff; border-color: #1f4470; background: #0d1f3c; }
  .badge.active { color: var(--green); border-color: #1b4721; background: #0d2818; }
  .badge.inactive { color: var(--red); border-color: #5a1e1e; background: #2d1111; }

  /* Model Grid */
  .models-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
    margin-top: 14px;
  }
  .model-card {
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: all 0.2s ease;
  }
  .model-card:hover {
    border-color: #58a6ff;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  }
  .model-card.is-pinned {
    border-color: #855b14;
    background: #14171c;
  }
  .model-card.is-hidden {
    opacity: 0.55;
  }
  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }
  .model-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }
  .model-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .model-raw {
    font-size: 11px;
    color: var(--text-dim);
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-actions {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .btn-icon {
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    border-radius: 6px;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s ease;
    padding: 0;
  }
  .btn-icon:hover {
    background: var(--btn-hover);
    color: var(--text);
    border-color: var(--text-muted);
  }
  .btn-icon.active {
    background: #2b2310;
    border-color: #855b14;
    color: #e3b341;
  }
  .star-btn {
    filter: grayscale(100%);
    opacity: 0.65;
  }
  .star-btn:hover {
    filter: grayscale(30%);
    opacity: 1;
  }
  .star-btn.active {
    background: #2b2310;
    border-color: #855b14;
    color: #e3b341;
    filter: none;
    opacity: 1;
  }
  .badge-pinned {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 10px;
    background: #2b2310;
    color: #e3b341;
    border: 1px solid #855b14;
    font-weight: 500;
  }
  .badge-hidden {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 10px;
    background: #21262d;
    color: var(--text-muted);
    border: 1px solid var(--card-border);
  }
  .progress-track {
    width: 100%;
    height: 8px;
    background: var(--track);
    border-radius: 4px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s ease;
  }
  .model-stats {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 12px;
  }
  .stat-used { color: var(--text-muted); }
  .stat-pct { font-weight: 600; font-variant-numeric: tabular-nums; }
  .model-sub {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: var(--text-muted);
    padding-top: 6px;
    border-top: 1px solid #21262d;
  }
  .stat-rem strong { color: var(--text); }
  .reset-time { color: var(--text-dim); }
  .empty-grid-notice {
    padding: 20px;
    text-align: center;
    color: var(--text-muted);
    background: var(--bg);
    border: 1px dashed var(--card-border);
    border-radius: var(--radius);
    font-size: 12px;
    margin-top: 12px;
  }

  .timestamps {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--card-border);
    color: var(--text-muted);
    font-size: 12px;
  }
  .timestamps strong { color: var(--text); font-weight: 500; }
  .ts-sep { color: #30363d; margin: 0 6px; }
  .error-msg {
    color: var(--red);
    padding: 8px 12px;
    background: #2d1111;
    border: 1px solid #5a1e1e;
    border-radius: 6px;
    font-size: 12px;
    margin-top: 12px;
  }
  .no-data {
    color: var(--text-muted);
    font-size: 12px;
    font-style: italic;
    margin-top: 12px;
  }
  .limit-alert {
    padding: 6px 12px;
    border-radius: 6px;
    font-weight: 600;
    font-size: 12px;
    margin-top: 10px;
  }
  .limit-alert.limit {
    background: #2d1111;
    border: 1px solid #5a1e1e;
    color: var(--red);
  }
  .limit-alert.review {
    background: #2d2200;
    border: 1px solid #5a4400;
    color: var(--yellow);
  }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1><span class="logo">📊</span> 9Router Monitor Pro</h1>
      <div class="updated">Updated: ${escHtml(formatDate(data.fetchedAt.toISOString()))} · Auto-refresh: ${cfg.intervalSeconds}s</div>
    </div>
    <div class="header-actions">
      <button class="btn btn-primary" id="refreshBtn">⟳ Refresh</button>
      <button class="btn" id="setConnectionBtn">⚙ Setup Connection</button>
      <button class="btn" id="changeApiKeyBtn">🔑 Set API Key</button>
    </div>
  </div>

  <div class="toolbar">
    <div class="toolbar-row-top">
      <div class="search-box">
        <input type="text" id="searchInput" placeholder="🔍 Search model... (e.g. gemini, claude, sonnet, 3.8)">
      </div>
      <div class="sort-box">
        <select id="sortSelect">
          <option value="used_desc"${preferredSort === 'used_desc' ? ' selected' : ''}>Sort: Highest Usage (% desc)</option>
          <option value="used_asc"${preferredSort === 'used_asc' ? ' selected' : ''}>Sort: Lowest Usage (% asc)</option>
          <option value="remaining_desc"${preferredSort === 'remaining_desc' ? ' selected' : ''}>Sort: Most Remaining Quota</option>
          <option value="name_asc"${preferredSort === 'name_asc' ? ' selected' : ''}>Sort: Model Name (A → Z)</option>
          <option value="provider_asc"${preferredSort === 'provider_asc' ? ' selected' : ''}>Sort: Provider (A → Z)</option>
          <option value="account_asc"${preferredSort === 'account_asc' ? ' selected' : ''}>Sort: Account Name (A → Z)</option>
          <option value="reset_asc"${preferredSort === 'reset_asc' ? ' selected' : ''}>Sort: Nearest Reset Time</option>
        </select>
      </div>
    </div>
    <div class="toolbar-row-bottom">
      <div class="filter-chips">
        <button class="filter-chip${preferredFilter === 'all' ? ' active' : ''}" data-filter="all">All</button>
        <button class="filter-chip${preferredFilter === 'active' ? ' active' : ''}" data-filter="active">In Use (>0%)</button>
        <button class="filter-chip${preferredFilter === 'claude' ? ' active' : ''}" data-filter="claude">Claude</button>
        <button class="filter-chip${preferredFilter === 'gemini' ? ' active' : ''}" data-filter="gemini">Gemini</button>
        <button class="filter-chip${preferredFilter === 'other' ? ' active' : ''}" data-filter="other">Other</button>
        ${uniqueProviders
          .map((p) => {
            const fKey = 'provider:' + p.toLowerCase();
            const isActive = preferredFilter === fKey;
            return `<button class="filter-chip${
              isActive ? ' active' : ''
            }" data-filter="${escHtml(fKey)}">${escHtml(p)}</button>`;
          })
          .join('\n        ')}
      </div>
      <label class="show-hidden-toggle">
        <input type="checkbox" id="showHiddenCheck"> 👁️ Show hidden models
      </label>
    </div>
  </div>

  <div id="sectionsContainer">
    ${sectionsHtml}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let activeFilter = ${JSON.stringify(preferredFilter)};
    const searchInput = document.getElementById('searchInput');
    const sortSelect = document.getElementById('sortSelect');
    const showHiddenCheck = document.getElementById('showHiddenCheck');
    const chips = document.querySelectorAll('.filter-chip');

    document.getElementById('refreshBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });
    document.getElementById('setConnectionBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'setConnection' });
    });
    document.getElementById('changeApiKeyBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'changeApiKey' });
    });

    document.addEventListener('click', (e) => {
      const pinAccBtn = e.target.closest('.pinned-account-btn, .pin-account-btn');
      if (pinAccBtn) {
        const accountId = pinAccBtn.dataset.accountId;
        if (accountId) {
          vscode.postMessage({ command: 'togglePinAccount', accountId: accountId });
        }
        return;
      }
      const toggleBtn = e.target.closest('.toggle-btn');
      if (toggleBtn) {
        const connId = toggleBtn.dataset.connectionId;
        const currentActive = toggleBtn.dataset.active === 'true';
        if (connId) {
          vscode.postMessage({
            command: 'toggleProviderActive',
            connectionId: connId,
            newActive: !currentActive
          });
        }
        return;
      }
      const starBtn = e.target.closest('.star-btn, .pin-btn');
      if (starBtn) {
        const model = starBtn.dataset.model;
        if (model) {
          vscode.postMessage({ command: 'togglePinModel', modelName: model });
        }
        return;
      }
      const hideBtn = e.target.closest('.hide-btn');
      if (hideBtn) {
        const model = hideBtn.dataset.model;
        if (model) {
          vscode.postMessage({ command: 'toggleHide', model: model });
        }
        return;
      }
    });

    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        activeFilter = chip.dataset.filter;
        vscode.postMessage({ command: 'updateFilter', filter: activeFilter });
        applyFiltersAndSort();
      });
    });

    searchInput.addEventListener('input', () => {
      applyFiltersAndSort();
    });

    sortSelect.addEventListener('change', () => {
      vscode.postMessage({ command: 'updateSort', sort: sortSelect.value });
      applyFiltersAndSort();
    });

    showHiddenCheck.addEventListener('change', () => {
      applyFiltersAndSort();
    });

    function applyFiltersAndSort() {
      const query = (searchInput.value || '').trim().toLowerCase();
      const showHidden = showHiddenCheck.checked;
      const sortMode = sortSelect.value;
      const isProviderFilter = activeFilter.startsWith('provider:');
      const targetProvider = isProviderFilter ? activeFilter.replace('provider:', '') : null;

      const container = document.getElementById('sectionsContainer');
      const sections = Array.from(document.querySelectorAll('.provider-section'));

      sections.forEach(section => {
        const prov = (section.dataset.provider || '').toLowerCase();
        const accName = (section.dataset.name || '').toLowerCase();

        if (targetProvider && prov !== targetProvider) {
          section.style.display = 'none';
          return;
        }
        section.style.display = '';

        const grid = section.querySelector('.models-grid');
        if (!grid) return;
        const cards = Array.from(grid.querySelectorAll('.model-card'));
        let visibleCount = 0;

        cards.forEach(card => {
          const model = card.dataset.model || '';
          const title = card.dataset.title || '';
          const used = parseFloat(card.dataset.used || '0');
          const isHidden = card.dataset.hidden === 'true';

          const matchesSearch = !query || model.includes(query) || title.includes(query) || accName.includes(query) || prov.includes(query);
          let matchesCategory = true;
          if (activeFilter === 'active') {
            matchesCategory = used > 0;
          } else if (activeFilter === 'claude') {
            matchesCategory = model.includes('claude') || title.includes('claude');
          } else if (activeFilter === 'gemini') {
            matchesCategory = model.includes('gemini') || title.includes('gemini');
          } else if (activeFilter === 'other') {
            matchesCategory = !model.includes('claude') && !title.includes('claude') && !model.includes('gemini') && !title.includes('gemini');
          }

          const matchesHidden = showHidden || !isHidden;

          if (matchesSearch && matchesCategory && matchesHidden) {
            card.style.display = '';
            visibleCount++;
          } else {
            card.style.display = 'none';
          }
        });

        cards.sort((a, b) => {
          if (sortMode === 'used_desc') {
            return parseFloat(b.dataset.pct || '0') - parseFloat(a.dataset.pct || '0');
          }
          if (sortMode === 'used_asc') {
            return parseFloat(a.dataset.pct || '0') - parseFloat(b.dataset.pct || '0');
          }
          if (sortMode === 'remaining_desc') {
            return parseFloat(b.dataset.remaining || '0') - parseFloat(a.dataset.remaining || '0');
          }
          if (sortMode === 'name_asc') {
            return (a.dataset.title || '').localeCompare(b.dataset.title || '');
          }
          if (sortMode === 'reset_asc') {
            const ra = parseFloat(a.dataset.reset || '0');
            const rb = parseFloat(b.dataset.reset || '0');
            if (ra === 0) return 1;
            if (rb === 0) return -1;
            return ra - rb;
          }
          return 0;
        });

        cards.forEach(card => grid.appendChild(card));

        const notice = section.querySelector('.empty-grid-notice');
        if (notice) {
          notice.style.display = visibleCount === 0 ? 'block' : 'none';
        }
      });

      if (container) {
        if (sortMode === 'provider_asc') {
          sections.sort((a, b) => (a.dataset.provider || '').localeCompare(b.dataset.provider || ''));
          sections.forEach(s => container.appendChild(s));
        } else if (sortMode === 'account_asc') {
          sections.sort((a, b) => (a.dataset.name || '').localeCompare(b.dataset.name || ''));
          sections.forEach(s => container.appendChild(s));
        }
      }
    }

    applyFiltersAndSort();
  </script>
</body>
</html>`;
}

function chooseQuotaName(
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

function displayName(connection: ProviderConnection): string {
  return connection.name ?? connection.email ?? connection.provider ?? connection.id;
}

function connectionPlan(connection: ProviderConnection): string | undefined {
  return toOptionalString(connection.providerSpecificData.chatgptPlanType);
}

function quotaTitle(name: string): string {
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

function quotaShortName(name: string): string {
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

function formatResetCompact(iso?: string): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) {
    return timeStr;
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${timeStr}`;
}

function formatQuotaForStatus(name: string, quota: QuotaData): string {
  const resetStr = formatResetCompact(quota.resetAt);
  const resetTag = resetStr ? ` (${resetStr})` : '';
  if (quota.unlimited) {
    return `${quotaShortName(name)} ∞${resetTag}`;
  }
  return `${quotaShortName(name)} ${formatCompact(quota.remaining)}/${formatCompact(
    quota.total
  )}${resetTag}`;
}

function getUsedPercent(quota: QuotaData): number {
  if (quota.unlimited || quota.total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (quota.used / quota.total) * 100));
}

function getRemainingPercent(quota: QuotaData): number {
  if (quota.unlimited) {
    return 100;
  }
  if (quota.total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (quota.remaining / quota.total) * 100));
}

function renderTextBar(pct: number, width = 8): string {
  const clamped = Math.min(100, Math.max(0, pct));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return '■'.repeat(filled) + '□'.repeat(empty);
}

function getHealthIcon(remPct: number): string {
  if (remPct <= 5) return '🔴';
  if (remPct <= 15) return '🟡';
  return '🟢';
}

function renderBar(pct: number, width = 40): string {
  const clamped = Math.min(100, Math.max(0, pct));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;

  let color = '#3fb950';
  if (clamped >= 95) {
    color = '#f85149';
  } else if (clamped >= 85) {
    color = '#d29922';
  }

  const unit = '&nbsp;';
  const filledBar =
    filled > 0
      ? `<span style="background-color:${color};">${unit.repeat(filled)}</span>`
      : '';
  const emptyBar =
    empty > 0
      ? `<span style="background-color:#3a3f47;">${unit.repeat(empty)}</span>`
      : '';
  return filledBar + emptyBar;
}

function truncateName(name: string, maxLen: number): string {
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

function formatCompact(n: number): string {
  if (n >= 1_000_000) {
    return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  }
  if (n >= 1_000) {
    return (n / 1_000).toFixed(1).replace(/\.?0+$/, '') + 'K';
  }
  return String(n);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
}
