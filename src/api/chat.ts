/**
 * One turn of the conversation. Deliberately the smallest shape the server
 * accepts rather than the SDK's own message type — the SDK is a server
 * dependency, and pulling it into the renderer would put a large package in
 * the bundle to describe two fields.
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Whether this build can answer questions at all.
 *
 * A web deploy has no key behind it by design, and an unreachable server is
 * the same answer, so both resolve to false rather than throwing: the panel
 * should be absent, not broken.
 */
export async function chatAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch('/api/chat', { signal });
    if (!res.ok) return false;
    const body = (await res.json()) as { available?: boolean };
    return body.available === true;
  } catch {
    return false;
  }
}

/**
 * Ask, and receive the answer as it is written.
 *
 * The reply arrives as a plain text stream, so `onText` is called many times
 * with fragments — the caller appends them. A failure before the first token
 * is a JSON error with a status, which is why the non-2xx branch comes first
 * and can carry a sentence worth showing.
 */
export async function streamChat(
  context: string,
  messages: ChatMessage[],
  onText: (delta: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, messages }),
    signal,
  });

  if (!res.ok) {
    let reason: string | undefined;
    try {
      reason = ((await res.json()) as { error?: string }).error;
    } catch {
      // Not JSON — a proxy or a static host answering instead of the API.
    }
    throw new Error(reason ?? `Could not reach Claude (HTTP ${res.status}).`);
  }

  if (!res.body) throw new Error('Could not read the answer.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // `stream: true` so a multi-byte character split across two chunks is
      // held rather than decoded into a replacement character.
      onText(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) onText(tail);
  } finally {
    reader.releaseLock();
  }
}
