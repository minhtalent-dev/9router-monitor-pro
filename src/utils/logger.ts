import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('9Router Monitor Pro Debug');
  }
  return outputChannel;
}

function getTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

export function logDebug(category: string, message: string, data?: unknown): void {
  const line = `[${getTimestamp()}] [${category}] ${message}${data !== undefined ? ' ' + JSON.stringify(data) : ''}`;
  console.log(line);
  try {
    getOutputChannel().appendLine(line);
  } catch {
    // ignore if output channel disposed
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
