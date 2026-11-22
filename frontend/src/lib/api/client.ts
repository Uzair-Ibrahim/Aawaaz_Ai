function normalizeApiBaseUrl(raw?: string): string {
  const cleaned = (raw || 'http://localhost:4000/api/v1').trim().replace(/\/+$/, '');
  if (/\/api\/v1$/i.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned}/api/v1`;
}

export const API_BASE_URL = normalizeApiBaseUrl(
  process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL,
);

export const API_ORIGIN_URL = API_BASE_URL.replace(/\/api\/v1$/i, '');

export const API_WS_URL = API_BASE_URL.replace(/^http/i, (scheme) =>
  scheme.toLowerCase() === 'https' ? 'wss' : 'ws',
);

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  formData?: FormData;
  token?: string | null;
  organizationId?: string | null;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (!options.formData) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.organizationId) {
    headers['X-Organization-Id'] = options.organizationId;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      body: options.formData
        ? options.formData
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
    });
  } catch {
    throw new ApiClientError(
      0,
      'NETWORK_OFFLINE',
      'Unable to reach the Awaaz API server. Check your internet connection; local drafts are preserved.',
    );
  }

  if (!res.ok) {
    let errCode = `HTTP_${res.status}`;
    let errMessage = `Request failed with status ${res.status}`;
    let details: unknown;
    try {
      const json = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
      if (json.error?.code) errCode = json.error.code;
      if (json.error?.message) errMessage = json.error.message;
      details = json.error?.details;
    } catch {
      // Ignore parse failure
    }
    throw new ApiClientError(res.status, errCode, errMessage, details);
  }

  return (await res.json()) as T;
}
