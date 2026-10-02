import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { AuthContext } from '../types';
import { loginDashboard, SECRET_SESSION_TOKEN } from './authManager';
import { logDebug, logInfo, logWarn, logError } from '../utils/logger';

export interface RequestOptions {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

export function buildUrl(baseUrl: string, pathOrUrl: string): URL {
  try {
    return new URL(pathOrUrl, baseUrl);
  } catch {
    throw new Error(`Invalid URL: ${baseUrl} + ${pathOrUrl}`);
  }
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
    const startTime = Date.now();
    logDebug('HTTP', `>> ${method} ${target.toString()}`);

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
          const duration = Date.now() - startTime;

          if (status === 401 && allowRetry && auth.password) {
            logWarn('HTTP', `<< 401 Unauthorized for ${target.pathname} (${duration}ms). Refreshing token via login...`);
            try {
              const newToken = await loginDashboard(auth.baseUrl, auth.password);
              auth.authToken = newToken;
              await auth.context.secrets.store(SECRET_SESSION_TOKEN, newToken);
              logInfo('HTTP', `Re-login succeeded. Retrying ${method} ${target.pathname}...`);
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
              logError('HTTP', `Re-login failed for ${target.pathname}: ${msg}`);
              reject(new Error(`HTTP 401 (re-login failed): ${msg}`));
              return;
            }
          }

          if (status >= 400) {
            logWarn('HTTP', `<< ${method} ${target.pathname} -> HTTP ${status} (${duration}ms): ${body.slice(0, 160)}`);
          } else {
            logDebug('HTTP', `<< ${method} ${target.pathname} -> HTTP ${status} (${duration}ms)`);
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
      logError('HTTP', `Request timeout (25s): ${method} ${target.toString()}`);
      req.destroy(new Error('Request timed out (25s).'));
    });
    req.on('error', (err) => {
      logError('HTTP', `Network error for ${method} ${target.toString()}`, err);
      reject(err);
    });
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

export function fetchJson(
  target: URL,
  auth: AuthContext,
  allowRetry = true
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const client = target.protocol === 'http:' ? http : https;
    const startTime = Date.now();
    logDebug('HTTP', `>> GET ${target.toString()}`);

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
          const duration = Date.now() - startTime;

          if (status === 401 && allowRetry && auth.password) {
            logWarn('HTTP', `<< 401 Unauthorized for ${target.pathname} (${duration}ms). Refreshing token...`);
            try {
              const newToken = await loginDashboard(auth.baseUrl, auth.password);
              auth.authToken = newToken;
              await auth.context.secrets.store(SECRET_SESSION_TOKEN, newToken);
              logInfo('HTTP', `Re-login succeeded. Retrying GET ${target.pathname}...`);
              const retryResult = await fetchJson(target, auth, false);
              resolve(retryResult);
              return;
            } catch (loginErr) {
              const msg = loginErr instanceof Error ? loginErr.message : String(loginErr);
              logError('HTTP', `Re-login failed for ${target.pathname}: ${msg}`);
              reject(new Error(`HTTP 401 (re-login failed): ${msg}`));
              return;
            }
          }

          if (status < 200 || status >= 300) {
            logWarn('HTTP', `<< GET ${target.pathname} -> HTTP ${status} (${duration}ms): ${body.slice(0, 160)}`);
            reject(new Error(`HTTP ${status}: ${body.slice(0, 200)}`));
            return;
          }

          logDebug('HTTP', `<< GET ${target.pathname} -> HTTP ${status} (${duration}ms)`);

          try {
            resolve(JSON.parse(body) as unknown);
          } catch (parseErr) {
            logError('HTTP', `Failed to parse JSON response from ${target.pathname}`, parseErr);
            reject(new Error('Failed to parse JSON response.'));
          }
        });
      }
    );

    req.setTimeout(25000, () => {
      logError('HTTP', `Request timeout (25s): GET ${target.toString()}`);
      req.destroy(new Error('Request timed out (25s).'));
    });
    req.on('error', (err) => {
      logError('HTTP', `Network error for GET ${target.toString()}`, err);
      reject(err);
    });
    req.end();
  });
}
