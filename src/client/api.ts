import type {
  ConfirmRequest,
  CustomPaperDto,
  JobDto,
  JobSummaryDto,
  OptimizeRequest,
  OrderDto,
  OrderInput,
  RunDto,
  SettingsProfileDto,
  StockInput,
  StockItemDto,
} from '../shared/api';
import type { CuttingSettings } from '../engine';

export class ApiRequestError extends Error {}

/** True in the browser-only (GitHub Pages) build, where the API runs in-process on a local database. */
export const STATIC_MODE = import.meta.env.MODE === 'pages';

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  if (STATIC_MODE) {
    const { localRequest } = await import('./local/localApi');
    try {
      return await localRequest<T>(method, url, body, signal);
    } catch (error) {
      if (error instanceof DOMException) throw error;
      throw new ApiRequestError(error instanceof Error ? error.message : 'İstek başarısız oldu.');
    }
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiRequestError('Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.');
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message ?? `İstek başarısız oldu (${res.status}).`;
    throw new ApiRequestError(message);
  }
  return data as T;
}

export const api = {
  stock: {
    list: () => request<StockItemDto[]>('GET', '/api/stock'),
    create: (body: Partial<StockInput>) => request<StockItemDto>('POST', '/api/stock', body),
    update: (id: number, body: Partial<StockInput>) => request<StockItemDto>('PUT', `/api/stock/${id}`, body),
    remove: (id: number) => request<void>('DELETE', `/api/stock/${id}`),
  },
  papers: {
    list: () => request<CustomPaperDto[]>('GET', '/api/papers'),
    create: (body: Omit<CustomPaperDto, 'id'>) => request<CustomPaperDto>('POST', '/api/papers', body),
    update: (id: number, body: Omit<CustomPaperDto, 'id'>) => request<CustomPaperDto>('PUT', `/api/papers/${id}`, body),
    remove: (id: number) => request<void>('DELETE', `/api/papers/${id}`),
  },
  settings: {
    get: () => request<CuttingSettings>('GET', '/api/settings'),
    save: (s: CuttingSettings) => request<CuttingSettings>('PUT', '/api/settings', s),
  },
  profiles: {
    list: () => request<SettingsProfileDto[]>('GET', '/api/profiles'),
    save: (name: string, settings: CuttingSettings) => request<SettingsProfileDto>('POST', '/api/profiles', { name, settings }),
    remove: (id: number) => request<void>('DELETE', `/api/profiles/${id}`),
  },
  admin: {
    resetAll: () => request<void>('POST', '/api/admin/reset', { confirm: 'TUM-VERILERI-SIL' }),
  },
  orders: {
    list: () => request<OrderDto[]>('GET', '/api/orders'),
    create: (body: OrderInput) => request<OrderDto>('POST', '/api/orders', body),
    update: (id: number, body: OrderInput) => request<OrderDto>('PUT', `/api/orders/${id}`, body),
    remove: (id: number) => request<void>('DELETE', `/api/orders/${id}`),
  },
  optimize: (body: OptimizeRequest, signal?: AbortSignal) => request<RunDto>('POST', '/api/optimize', body, signal),
  runs: {
    get: (id: string) => request<RunDto>('GET', `/api/runs/${id}`),
    confirm: (id: string, body: ConfirmRequest) => request<JobDto>('POST', `/api/runs/${id}/confirm`, body),
  },
  jobs: {
    list: () => request<JobSummaryDto[]>('GET', '/api/jobs'),
    get: (id: number) => request<JobDto>('GET', `/api/jobs/${id}`),
    addOffcut: (jobId: number, offcutId: number) => request<JobDto>('POST', `/api/jobs/${jobId}/offcuts/${offcutId}/add`, {}),
    discardOffcut: (jobId: number, offcutId: number) => request<JobDto>('POST', `/api/jobs/${jobId}/offcuts/${offcutId}/discard`, {}),
  },
};
