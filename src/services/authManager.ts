import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AuthContext, ExtensionConfig } from '../types';
import { logDebug, logInfo, logWarn, logError } from '../utils/logger';

export const SECRET_PASSWORD = 'aiTokenUsage.dashboardPassword';
export const SECRET_SESSION_TOKEN = 'aiTokenUsage.sessionToken';
export const SECRET_API_KEY = 'aiTokenUsage.apiKey';

function buildUrl(baseUrl: string, pathOrUrl: string): URL {
  try {
    return new URL(pathOrUrl, baseUrl);
  } catch {
    throw new Error(`Invalid URL: ${baseUrl} + ${pathOrUrl}`);
  }
}

// Cache quét token CLI (TTL 30s) để tránh đọc đĩa và ghi log lặp lại
const CLI_TOKEN_CACHE_TTL_MS = 30_000;
let cliTokenCache: { tokens: string[]; expiresAt: number; signature: string } | undefined;
let lastLoggedSignature: string | undefined;
let lastAuthContextKey: string | undefined;
let loginInFlight: Promise<string> | null = null;

export function clearCliTokenCache(): void {
  cliTokenCache = undefined;
}

export async function setConnection(
  context: vscode.ExtensionContext,
  password?: string,
  sessionToken?: string
): Promise<void> {
  clearCliTokenCache();
  if (password !== undefined) {
    if (password) {
      await context.secrets.store(SECRET_PASSWORD, password);
    } else {
      await context.secrets.delete(SECRET_PASSWORD);
    }
  }
  if (sessionToken !== undefined) {
    if (sessionToken) {
      await context.secrets.store(SECRET_SESSION_TOKEN, sessionToken);
    } else {
      await context.secrets.delete(SECRET_SESSION_TOKEN);
    }
  }
}

export async function clearConnection(
  context: vscode.ExtensionContext
): Promise<void> {
  clearCliTokenCache();
  await context.secrets.delete(SECRET_PASSWORD);
  await context.secrets.delete(SECRET_SESSION_TOKEN);
}

export function getAllLocalCliTokens(): string[] {
  if (cliTokenCache && Date.now() < cliTokenCache.expiresAt) {
    return cliTokenCache.tokens;
  }

  const rawDirs = [
    process.env.APPDATA ? path.join(process.env.APPDATA, '9router') : null,
    path.join(os.homedir(), 'AppData', 'Roaming', '9router'),
    process.env.XDG_CONFIG_HOME
      ? path.join(process.env.XDG_CONFIG_HOME, '9router')
      : path.join(os.homedir(), '.config', '9router'),
    path.join(os.homedir(), 'Library', 'Application Support', '9router'),
    path.join(os.homedir(), '.9router')
  ].filter((dir): dir is string => Boolean(dir));

  // Loại trùng đường dẫn (Windows không phân biệt hoa thường), giữ nguyên casing gốc
  const seenDirs = new Set<string>();
  const candidateDirs = rawDirs.filter((dir) => {
    const resolved = path.resolve(dir);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seenDirs.has(key)) {
      return false;
    }
    seenDirs.add(key);
    return true;
  });

  const candidates: { token: string; mtime: number; secretPath: string }[] = [];

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

      const stat = fs.statSync(secretPath);
      const machineId = fs.readFileSync(machineIdPath, 'utf-8').trim();
      const cliSecret = fs.readFileSync(secretPath, 'utf-8').trim();
      if (machineId && cliSecret) {
        const token = crypto
          .createHash('sha256')
          .update(machineId + '9r-cli-auth' + cliSecret)
          .digest('hex')
          .substring(0, 16);
        candidates.push({ token, mtime: stat.mtimeMs, secretPath });
      }
    } catch {
      // Ignore file read errors and continue checking other directories
    }
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  const uniqueTokens: string[] = [];
  for (const item of candidates) {
    if (!uniqueTokens.includes(item.token)) {
      uniqueTokens.push(item.token);
    }
  }

  // Chữ ký = đường dẫn + token; chỉ ghi log khi thay đổi so với lần log trước
  const signature = candidates.map((c) => `${c.secretPath}:${c.token}`).join('|');
  if (signature !== lastLoggedSignature) {
    lastLoggedSignature = signature;
    for (const c of candidates) {
      logDebug('Auth', `Found candidate CLI secret at ${c.secretPath}`);
    }
    if (uniqueTokens.length > 0) {
      logInfo('Auth', `Loaded ${uniqueTokens.length} local CLI token(s) (sorted by mtime).`);
    }
  }

  cliTokenCache = { tokens: uniqueTokens, expiresAt: Date.now() + CLI_TOKEN_CACHE_TTL_MS, signature };
  return uniqueTokens;
}

export function getLocalCliToken(): string | null {
  const tokens = getAllLocalCliTokens();
  return tokens.length > 0 ? tokens[0] : null;
}

export function loginDashboard(baseUrl: string, password: string): Promise<string> {
  if (loginInFlight) {
    return loginInFlight;
  }

  const promise = new Promise<string>((resolve, reject) => {
    let target: URL;
    try {
      target = buildUrl(baseUrl, '/api/auth/login');
    } catch (err) {
      logError('Auth', `Invalid login URL: ${baseUrl}`, err);
      reject(err);
      return;
    }

    const client = target.protocol === 'http:' ? http : https;
    const postData = JSON.stringify({ password });
    const startTime = Date.now();
    logInfo('Auth', `Attempting Dashboard login at ${target.toString()}...`);

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
          const duration = Date.now() - startTime;

          if (status < 200 || status >= 300) {
            let detail = '';
            try {
              const parsed = JSON.parse(body) as { error?: string; message?: string };
              detail = parsed.error || parsed.message || '';
            } catch {
              detail = body.slice(0, 200);
            }
            const msg = detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
            logError('Auth', `Dashboard login failed (${msg}) in ${duration}ms`);
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
            logInfo('Auth', `Dashboard login succeeded in ${duration}ms. Session token acquired.`);
            resolve(token);
          } else {
            logError('Auth', `Login response did not contain auth_token in ${duration}ms`);
            reject(new Error('auth_token not found in login response.'));
          }
        });
      }
    );

    req.setTimeout(15000, () => {
      logError('Auth', `Login request timed out (15s) for ${target.toString()}`);
      req.destroy(new Error('Login request timed out (15s).'));
    });
    req.on('error', (err) => {
      logError('Auth', `Network error during login at ${target.toString()}`, err);
      reject(err);
    });
    req.write(postData);
    req.end();
  });

  loginInFlight = promise.finally(() => {
    loginInFlight = null;
  });

  return loginInFlight;
}

export async function getAuthContext(
  context: vscode.ExtensionContext,
  baseUrlOrConfig?: string | ExtensionConfig
): Promise<AuthContext | undefined> {
  const targetBaseUrl =
    (typeof baseUrlOrConfig === 'string'
      ? baseUrlOrConfig
      : baseUrlOrConfig?.baseUrl) ??
    vscode.workspace
      .getConfiguration('aiTokenUsage')
      .get<string>('apiBaseUrl', 'http://localhost:20128');

  const password = await context.secrets.get(SECRET_PASSWORD);
  let sessionToken = await context.secrets.get(SECRET_SESSION_TOKEN);
  const legacyApiKey = await context.secrets.get(SECRET_API_KEY);
  const localCliToken = getLocalCliToken() ?? undefined;

  if (!password && !sessionToken && !legacyApiKey && !localCliToken) {
    logDebug('Auth', `No credentials found for ${targetBaseUrl}`);
    return undefined;
  }

  if (password && !sessionToken) {
    try {
      sessionToken = await loginDashboard(targetBaseUrl, password);
      await context.secrets.store(SECRET_SESSION_TOKEN, sessionToken);
    } catch (loginErr) {
      logWarn('Auth', `Initial session token generation failed: ${loginErr instanceof Error ? loginErr.message : String(loginErr)}`);
    }
  }

  const ctxKey = `${targetBaseUrl}|${Boolean(sessionToken)}|${Boolean(localCliToken)}`;
  if (ctxKey !== lastAuthContextKey) {
    lastAuthContextKey = ctxKey;
    logDebug('Auth', `AuthContext resolved for ${targetBaseUrl} (hasSession=${Boolean(sessionToken)}, hasCli=${Boolean(localCliToken)})`);
  }

  return {
    authToken: sessionToken,
    password,
    cliToken: localCliToken,
    legacyApiKey,
    baseUrl: targetBaseUrl,
    context
  };
}
