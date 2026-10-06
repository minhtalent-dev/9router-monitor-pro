import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SharedCachePayload } from '../types';
import { logDebug, logWarn } from '../utils/logger';

const CACHE_VERSION = 1;
const QUOTA_TTL_MS = 45_000;
const LOGS_TTL_MS = 7_000;

let sharedCacheFilePath: string | undefined;
let sharedCacheDir: string | undefined;
let lastLocalWriteTime = 0;
let fileWatcher: fs.FSWatcher | undefined;
let debounceTimer: NodeJS.Timeout | undefined;

export function initSharedCache(context: vscode.ExtensionContext): void {
  try {
    let baseDir: string;
    if (context.globalStorageUri && context.globalStorageUri.fsPath) {
      baseDir = context.globalStorageUri.fsPath;
    } else {
      baseDir = path.join(os.tmpdir(), '9router-monitor-pro');
    }

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    sharedCacheDir = baseDir;
    sharedCacheFilePath = path.join(baseDir, 'shared_cache.json');
    logDebug('SharedCache', `Initialized shared cache at: ${sharedCacheFilePath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logWarn('SharedCache', `Failed to initialize shared cache directory: ${msg}`);
  }
}

export function getSharedCachePath(): string | undefined {
  return sharedCacheFilePath;
}

export function readSharedCache(): SharedCachePayload | null {
  if (!sharedCacheFilePath || !fs.existsSync(sharedCacheFilePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(sharedCacheFilePath, 'utf8');
    if (!raw || raw.trim().length === 0) {
      return null;
    }
    const parsed = JSON.parse(raw) as SharedCachePayload;
    if (!parsed || parsed.version !== CACHE_VERSION) {
      return null;
    }
    // Chuyển đổi fetchedAt về kiểu Date nếu bị serialize thành string
    if (parsed.dashboard && typeof parsed.dashboard.fetchedAt === 'string') {
      parsed.dashboard.fetchedAt = new Date(parsed.dashboard.fetchedAt);
    }
    return parsed;
  } catch (err) {
    // Tránh crash khi file đang được ghi dở bởi process khác
    const msg = err instanceof Error ? err.message : String(err);
    logDebug('SharedCache', `Read shared cache skipped or corrupted: ${msg}`);
    return null;
  }
}

export function writeSharedCache(patch: Partial<SharedCachePayload>): void {
  if (!sharedCacheFilePath) {
    return;
  }
  try {
    const existing = readSharedCache() ?? {
      version: CACHE_VERSION,
      quotaUpdatedAt: 0,
      logsUpdatedAt: 0
    };

    const merged: SharedCachePayload = {
      ...existing,
      ...patch,
      version: CACHE_VERSION
    };

    const json = JSON.stringify(merged, null, 2);
    const dir = path.dirname(sharedCacheFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Ghi atomic qua file tạm để chống lỗi đọc file dở dang
    const tmpPath = `${sharedCacheFilePath}.tmp.${process.pid}.${Date.now()}`;
    lastLocalWriteTime = Date.now();

    try {
      fs.writeFileSync(tmpPath, json, 'utf8');
      fs.renameSync(tmpPath, sharedCacheFilePath);
    } catch (renameErr) {
      // Fallback trên Windows nếu bị EPERM/EBUSY do file lock
      fs.writeFileSync(sharedCacheFilePath, json, 'utf8');
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logWarn('SharedCache', `Failed to write shared cache: ${msg}`);
  }
}

export function isQuotaCacheFresh(): boolean {
  const cache = readSharedCache();
  if (!cache || !cache.dashboard || !cache.quotaUpdatedAt) {
    return false;
  }
  return Date.now() - cache.quotaUpdatedAt < QUOTA_TTL_MS;
}

export function isLogsCacheFresh(): boolean {
  const cache = readSharedCache();
  if (!cache || !cache.logsUpdatedAt) {
    return false;
  }
  return Date.now() - cache.logsUpdatedAt < LOGS_TTL_MS;
}

export function startCacheWatcher(
  onChange: (cache: SharedCachePayload) => void
): vscode.Disposable {
  if (!sharedCacheDir) {
    return new vscode.Disposable(() => {});
  }

  try {
    if (fileWatcher) {
      fileWatcher.close();
      fileWatcher = undefined;
    }

    // Quan sát thư mục chứa file cache để nhận thông báo an toàn trên Windows
    fileWatcher = fs.watch(sharedCacheDir, (eventType, filename) => {
      if (filename && !filename.includes('shared_cache.json')) {
        return;
      }
      // Bỏ qua nếu sự kiện vừa do chính cửa sổ này ghi trong vòng 300ms
      if (Date.now() - lastLocalWriteTime < 300) {
        return;
      }

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        const fresh = readSharedCache();
        if (fresh) {
          onChange(fresh);
        }
      }, 250);
    });

    logDebug('SharedCache', `File watcher started on: ${sharedCacheDir}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logWarn('SharedCache', `Could not start file watcher: ${msg}`);
  }

  return new vscode.Disposable(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    if (fileWatcher) {
      fileWatcher.close();
      fileWatcher = undefined;
    }
  });
}
