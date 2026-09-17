import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AuthContext, ExtensionConfig } from '../types';

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

export function getLocalCliToken(): string | null {
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

export function loginDashboard(baseUrl: string, password: string): Promise<string> {
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

export async function getAuthContext(
  context: vscode.ExtensionContext,
  baseUrl?: string
): Promise<AuthContext | undefined> {
  const targetBaseUrl =
    baseUrl ??
    vscode.workspace
      .getConfiguration('aiTokenUsage')
      .get<string>('apiBaseUrl', 'http://localhost:20128');

  const password = await context.secrets.get(SECRET_PASSWORD);
  let sessionToken = await context.secrets.get(SECRET_SESSION_TOKEN);
  const legacyApiKey = await context.secrets.get(SECRET_API_KEY);
  const localCliToken = getLocalCliToken() ?? undefined;

  if (!password && !sessionToken && !legacyApiKey && !localCliToken) {
    return undefined;
  }

  if (password && !sessionToken) {
    try {
      sessionToken = await loginDashboard(targetBaseUrl, password);
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
    baseUrl: targetBaseUrl,
    context
  };
}
