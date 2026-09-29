import { PullRequestApiError } from './PullRequestProvider';

export interface JsonRequest {
  url: string;
  method?: string;
  token: string;
  /**
   * How `token` is presented. GitLab's PAT auth uses a custom header, not
   * Bearer. Bitbucket App Passwords are HTTP Basic — `token` is already the
   * base64-encoded `username:app_password` pair for that mode, encoded once
   * at sign-in time rather than on every request.
   */
  authHeader?: 'Authorization' | 'PRIVATE-TOKEN' | 'Basic';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * The one funnel every provider's HTTP client sends requests through —
 * mirrors `GitProcess.ts`'s single-spawn-point convention. Node 20's global
 * `fetch` is used directly; nothing here is webview code, so the CSP that
 * forbids `connect-src` in the panel does not apply.
 */
export async function requestJson<T>(request: JsonRequest): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...request.headers,
  };

  if (request.authHeader === 'PRIVATE-TOKEN') {
    headers['PRIVATE-TOKEN'] = request.token;
  } else if (request.authHeader === 'Basic') {
    headers.Authorization = `Basic ${request.token}`;
  } else {
    headers.Authorization = `Bearer ${request.token}`;
  }

  const response = await fetch(request.url, {
    method: request.method ?? 'GET',
    headers,
    ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new PullRequestApiError(
      `${request.method ?? 'GET'} ${request.url} failed: ${response.status} ${text}`.trim(),
      response.status,
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
