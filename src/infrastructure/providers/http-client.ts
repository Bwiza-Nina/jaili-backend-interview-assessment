import { ProviderRequestError } from '../../domain/errors';

export async function callProvider(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): Promise<{ status: number; data: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }

    // 5xx / 429 = temporary -> retry. Other 4xx = provider refused -> do NOT retry.
    if (res.status >= 500 || res.status === 429) {
      throw new ProviderRequestError(`Provider unavailable (${res.status})`, true);
    }
    if (!res.ok) throw new ProviderRequestError(`Provider rejected request (${res.status})`, false);
    return { status: res.status, data };
  } catch (e: any) {
    if (e instanceof ProviderRequestError) throw e;
    throw new ProviderRequestError(`Network error/timeout (${e?.name})`, true);
  } finally {
    clearTimeout(timer);
  }
}