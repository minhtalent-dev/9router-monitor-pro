import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function initLogger(context: vscode.ExtensionContext): vscode.OutputChannel {
  const channel = getOutputChannel();
  context.subscriptions.push(channel);
  return channel;
}

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('9Router Monitor Pro Debug');
  }
  return outputChannel;
}

export function showOutputChannel(preserveFocus = true): void {
  try {
    getOutputChannel().show(preserveFocus);
  } catch {
    // ignore
  }
}

function getTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'sessiontoken',
  'clitoken',
  'secret',
  'authorization',
  'x-9r-cli-token',
  'apikey',
  'api_key',
  'auth_token'
]);

function maskSensitive(val: string): string {
  if (!val) return '';
  if (val.length <= 8) return '***';
  return val.slice(0, 4) + '***' + val.slice(-4);
}

export function sanitizeData(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    if (data.toLowerCase().startsWith('bearer ')) {
      return 'Bearer ' + maskSensitive(data.slice(7));
    }
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(sanitizeData);
  }
  if (typeof data === 'object') {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        res[k] = typeof v === 'string' ? maskSensitive(v) : '***';
      } else if (typeof v === 'object' && v !== null) {
        res[k] = sanitizeData(v);
      } else {
        res[k] = v;
      }
    }
    return res;
  }
  return data;
}

function formatPayload(data?: unknown): string {
  if (data === undefined) return '';
  try {
    const clean = sanitizeData(data);
    return ' ' + JSON.stringify(clean);
  } catch {
    return ' [unserializable payload]';
  }
}

export function logInfo(category: string, message: string, data?: unknown): void {
  const line = `[${getTimestamp()}] [${category}] [INFO] ${message}${formatPayload(data)}`;
  console.log(line);
  try {
    getOutputChannel().appendLine(line);
  } catch {
    // ignore
  }
}

export function logWarn(category: string, message: string, data?: unknown): void {
  const line = `[${getTimestamp()}] [${category}] [WARN] ${message}${formatPayload(data)}`;
  console.warn(line);
  try {
    getOutputChannel().appendLine(line);
  } catch {
    // ignore
  }
}

export function logDebug(category: string, message: string, data?: unknown): void {
  const line = `[${getTimestamp()}] [${category}] [DEBUG] ${message}${formatPayload(data)}`;
  console.log(line);
  try {
    getOutputChannel().appendLine(line);
  } catch {
    // ignore
  }
}

export function logError(category: string, message: string, error?: unknown): void {
  const errStr = error instanceof Error ? error.stack || error.message : String(error ?? '');
  const line = `[${getTimestamp()}] [${category}] [ERROR] ${message} ${errStr}`;
  console.error(line);
  try {
    getOutputChannel().appendLine(line);
  } catch {
    // ignore
  }
}
