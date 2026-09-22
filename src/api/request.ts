/**
 * The one way this app talks to its own API.
 *
 * Paths are relative because the page and the API are one Next project on one
 * origin. There is no base URL to configure and nothing to get wrong between
 * builds.
 */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });

  // DELETE answers 204, which has no body to parse.
  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON — a proxy or a static host answering instead of the API.
  }

  if (!res.ok) {
    // The API reports failures as {error: "..."}, written to be shown as-is.
    const reason = (body as { error?: string } | null)?.error;
    throw new Error(reason ?? `Could not reach the spot list (HTTP ${res.status}).`);
  }
  return body as T;
}
