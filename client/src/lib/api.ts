export class ApiError extends Error {
  constructor(public status: number, public code: string, public fields: Record<string, string> = {}) {
    super('The request could not be completed.');
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options, credentials: 'same-origin', cache: 'no-store',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, 'NETWORK_ERROR');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.error?.fields ?? {})) {
      if (typeof value === 'string') fields[key] = value;
    }
    throw new ApiError(response.status, typeof body.error?.code === 'string' ? body.error.code : 'REQUEST_FAILED', fields);
  }
  if (response.status === 204) return undefined as T;
  try { return await response.json() as T; }
  catch { throw new ApiError(0, 'INVALID_RESPONSE'); }
}
