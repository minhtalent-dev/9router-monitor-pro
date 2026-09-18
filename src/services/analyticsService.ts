import {
  AuthContext,
  ExtensionConfig,
  RequestLogItem,
  UsageStats
} from '../types';
import {
  asRecord,
  toNumber,
  toOptionalString
} from '../utils/helpers';
import { buildUrl, requestWithAuth } from './httpTransport';

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
  limit = 50
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
