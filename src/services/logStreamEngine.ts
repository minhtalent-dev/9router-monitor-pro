import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import {
  AuthContext,
  ConsoleStreamMessage,
  ExtensionConfig,
  RequestLogItem
} from '../types';
import { logDebug, logError } from '../utils/logger';
import {
  getAllLocalCliTokens,
  loginDashboard,
  SECRET_SESSION_TOKEN
} from './authManager';
import { buildUrl, requestWithAuth } from './httpTransport';
import { fetchRequestLogs } from './analyticsService';

export function isLocalhostUrl(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    const h = u.hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
  } catch {
    return true;
  }
}

export function formatRequestLogAsConsoleLine(item: RequestLogItem): string {
  const timePart = item.timestamp || '00:00:00';
  const inStr = item.inTokens >= 1000 ? (item.inTokens / 1000).toFixed(1) + 'K' : String(item.inTokens);
  const outStr = item.outTokens >= 1000 ? (item.outTokens / 1000).toFixed(1) + 'K' : String(item.outTokens);
  const isOk = item.status.toLowerCase() === 'ok';
  const statusIcon = isOk ? '🟢 📊' : '🔴 ⚠️';
  const statusLabel = isOk ? 'DONE' : 'FAIL';
  return `[${timePart}] ${statusIcon} ${statusLabel} · ${item.model} · ${item.provider} · IN ${inStr} · OUT ${outStr} · ACC:${item.account}`;
}

export interface ConsoleStreamOptions {
  pollIntervalMs?: number;
  initialLimit?: number;
}

export function openConsoleLogStream(
  config: ExtensionConfig,
  auth: AuthContext,
  onEvent: (msg: ConsoleStreamMessage) => void,
  onError: (err: Error) => void,
  onSystem?: (msg: string) => void,
  options?: ConsoleStreamOptions
): () => void {
  const pollIntervalMs = options?.pollIntervalMs ?? 2500;
  const initialLimit = options?.initialLimit ?? 500;
  let isAborted = false;
  let pollTimer: NodeJS.Timeout | undefined;
  let watchdogTimer: NodeJS.Timeout | undefined;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let activeReq: http.ClientRequest | undefined;
  let receivedSseChunk = false;
  let isFallbackPolling = false;
  const knownKeys = new Set<string>();

  const startTunnelPolling = async () => {
    try {
      const initialLogs = await fetchRequestLogs(config, auth, 1, initialLimit);
      if (isAborted) return;
      // Reverse so oldest is first
      const chronological = [...initialLogs].reverse();
      for (const item of chronological) {
        knownKeys.add(item.raw);
      }
      const formatted = chronological.map(formatRequestLogAsConsoleLine);
      onEvent({ type: 'init', logs: formatted });
      onSystem?.(`[TUNNEL LIVE] Stream connected. Loaded ${formatted.length} live transactions via Tunnel.`);

      if (pollIntervalMs > 0) {
        pollTimer = setInterval(async () => {
          if (isAborted) return;
          try {
            const recent = await fetchRequestLogs(config, auth, 1, 50);
            if (isAborted) return;
            const newItems = [...recent].reverse().filter((it) => !knownKeys.has(it.raw));
            for (const it of newItems) {
              knownKeys.add(it.raw);
              if (knownKeys.size > 2000) {
                // Keep known set bounded
                const first = knownKeys.values().next().value;
                if (first) knownKeys.delete(first);
              }
              onEvent({ type: 'line', line: formatRequestLogAsConsoleLine(it) });
            }
          } catch (pollErr) {
            logError('TunnelPoll', 'Polling error:', pollErr);
          }
        }, pollIntervalMs);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError('TunnelPoll', 'Initial fetch error:', err);
      onError(new Error(`Tunnel log fetch error: ${msg}`));
    }
  };

  const isLocal = isLocalhostUrl(config.baseUrl);

  if (!isLocal) {
    logDebug('TunnelStream', `Activating Tunnel Adaptive Log Mode for ${config.baseUrl}`);
    onSystem?.(`[TUNNEL] Cloudflare Tunnel detected (${config.baseUrl}). Connecting via Live Transaction Stream...`);

    void startTunnelPolling();

    return () => {
      isAborted = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    };
  }

  // Localhost branch: connect via native SSE with watchdog fallback
  const candidateTokens = getAllLocalCliTokens();
  let tokenIdx = 0;

  const connect = () => {
    if (isAborted || isFallbackPolling) {
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

    logDebug('SSE', `Connecting to ${target.toString()}`, {
      baseUrl: config.baseUrl,
      hasAuthToken: Boolean(auth.authToken),
      cliToken: auth.cliToken ? auth.cliToken.slice(0, 6) + '...' : 'none',
      hasPassword: Boolean(auth.password)
    });
    onSystem?.(`[INIT] Connecting to ${target.toString()} (Token: ${auth.cliToken ? auth.cliToken.slice(0, 6) + '...' : 'none'})...`);

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
        logDebug('SSE', `Response received: HTTP ${res.statusCode} ${res.statusMessage || ''}`);
        onSystem?.(`[HTTP ${res.statusCode}] Connection established`);

        if (res.statusCode === 401) {
          logError('SSE', `HTTP 401 Unauthorized from ${target.toString()}`);
          onSystem?.(`[HTTP 401] Unauthorized. Retrying with refreshed credentials...`);
          res.resume();
          if (auth.password) {
            try {
              const newToken = await loginDashboard(auth.baseUrl, auth.password);
              auth.authToken = newToken;
              await auth.context.secrets.store(SECRET_SESSION_TOKEN, newToken);
              if (!isAborted && !isFallbackPolling) {
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
            if (!isAborted && !isFallbackPolling) {
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

        // Watchdog: If 3.5s pass without any SSE chunks, fallback to Tunnel Adaptive Polling
        if (watchdogTimer) {
          clearTimeout(watchdogTimer);
          watchdogTimer = undefined;
        }
        receivedSseChunk = false;
        watchdogTimer = setTimeout(() => {
          if (!receivedSseChunk && !isAborted && !isFallbackPolling) {
            isFallbackPolling = true;
            logDebug('SSEWatchdog', 'No SSE chunks received after 3.5s of HTTP 200, falling back to Tunnel Adaptive Polling.');
            onSystem?.('[WATCHDOG] SSE stream idle/buffered for 3.5s. Switching to Adaptive Polling Mode...');
            if (activeReq) {
              activeReq.destroy();
              activeReq = undefined;
            }
            void startTunnelPolling();
          }
        }, 3500);

        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          receivedSseChunk = true;
          if (watchdogTimer) {
            clearTimeout(watchdogTimer);
            watchdogTimer = undefined;
          }
          logDebug('SSE', `Chunk received: ${chunk.length} bytes`);
          try {
            buffer += chunk.toString('utf-8');
            let boundaryIndex: number;
            while ((boundaryIndex = buffer.indexOf('\n\n')) !== -1) {
              const eventBlock = buffer.slice(0, boundaryIndex);
              buffer = buffer.slice(boundaryIndex + 2);

              const lines = eventBlock.split(/\r?\n/);
              for (const rawLine of lines) {
                const line = rawLine.trim();
                if (line.startsWith('data:')) {
                  const jsonStr = line.slice(5).trim();
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
                      logDebug('SSE', `Event parsed: ${parsed.type}`, {
                        logsCount: 'logs' in parsed ? parsed.logs?.length : undefined,
                        line: 'line' in parsed ? parsed.line?.slice(0, 60) : undefined
                      });
                      onSystem?.(`[EVENT] Received: ${parsed.type}${('logs' in parsed && parsed.logs) ? ' (' + parsed.logs.length + ' logs)' : ''}`);
                      onEvent(parsed);
                    }
                  } catch (parseErr) {
                    // Ignore parse errors for malformed individual lines
                  }
                }
              }
            }
          } catch (chunkErr) {
            console.error('[SSE] Chunk processing error:', chunkErr);
          }
        });

        res.on('end', () => {
          logDebug('SSE', 'Socket closed / ended');
          onSystem?.('[SOCKET] Connection closed');
          if (!isAborted && !isFallbackPolling) {
            scheduleReconnect();
          }
        });

        res.on('close', () => {
          logDebug('SSE', 'Socket closed / ended');
          onSystem?.('[SOCKET] Connection closed');
          if (!isAborted && !isFallbackPolling) {
            scheduleReconnect();
          }
        });

        res.on('error', (err: Error) => {
          logError('SSE', `Socket error: ${err.message}`, err);
          onSystem?.(`[ERROR] ${err.message}`);
          if (!isAborted && !isFallbackPolling) {
            onError(err);
            scheduleReconnect();
          }
        });
      }
    );

    req.on('error', (err: Error) => {
      logError('SSE', `Socket error: ${err.message}`, err);
      onSystem?.(`[ERROR] ${err.message}`);
      if (!isAborted && !isFallbackPolling) {
        onError(err);
        scheduleReconnect();
      }
    });

    activeReq = req;
    req.end();
  };

  const scheduleReconnect = () => {
    if (isAborted || isFallbackPolling || reconnectTimer) {
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
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = undefined;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
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
