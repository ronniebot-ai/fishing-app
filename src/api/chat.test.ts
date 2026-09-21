/**
 * Reading the answer off the wire.
 *
 * The server's side of this is pinned down in `server/chat.test.js`; what is
 * left here is the reading: that a failure carries the sentence the server
 * wrote, that fragments arrive as fragments, and that a character split
 * across two of them survives the split.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatAvailable, streamChat } from './chat';

const encoder = new TextEncoder();

/** A Response whose body yields exactly these chunks, in order. */
function streaming(chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}

function answers(res: Response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chatAvailable', () => {
  it('is true only when the server says so', async () => {
    answers(Response.json({ available: true, model: 'claude-sonnet-5' }));
    expect(await chatAvailable()).toBe(true);

    answers(Response.json({ available: false, model: null }));
    expect(await chatAvailable()).toBe(false);
  });

  it('is false rather than an error when there is no server behind the page', async () => {
    // A static web deploy is the ordinary case, not a fault: the panel should
    // be absent, and absent is what false means.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    expect(await chatAvailable()).toBe(false);
  });
});

describe('streamChat', () => {
  it('hands over each fragment as it lands', async () => {
    answers(streaming(['Yes', ', ', 'about 3pm.'].map((c) => encoder.encode(c))));
    const seen: string[] = [];

    await streamChat('ctx', [{ role: 'user', content: 'Worth going?' }], (d) => seen.push(d));

    expect(seen).toEqual(['Yes', ', ', 'about 3pm.']);
  });

  it('keeps a character whole when it is split across two fragments', async () => {
    // The answers are full of degree signs and em dashes, and a naive decode
    // per chunk turns a straddling one into a replacement character.
    const bytes = encoder.encode('18°C and rising');
    answers(streaming([bytes.slice(0, 3), bytes.slice(3)]));

    let text = '';
    await streamChat('ctx', [{ role: 'user', content: 'How warm?' }], (d) => {
      text += d;
    });

    expect(text).toBe('18°C and rising');
  });

  it('posts the forecast and the transcript together', async () => {
    answers(streaming([encoder.encode('Yes.')]));
    const messages = [{ role: 'user' as const, content: 'Worth going?' }];

    await streamChat('the forecast', messages, () => {});

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ context: 'the forecast', messages });
  });

  it('throws the reason the server gave, so the panel can show it', async () => {
    answers(Response.json({ error: 'Too many questions at once.' }, { status: 429 }));

    await expect(
      streamChat('ctx', [{ role: 'user', content: 'Worth going?' }], () => {}),
    ).rejects.toThrow('Too many questions at once.');
  });

  it('falls back to the status when something that is not the API answers', async () => {
    // A proxy or a static host, which will not be speaking our error shape.
    answers(new Response('<!doctype html>', { status: 502 }));

    await expect(
      streamChat('ctx', [{ role: 'user', content: 'Worth going?' }], () => {}),
    ).rejects.toThrow(/502/);
  });

  it('stops reading when the caller aborts', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );
    controller.abort();

    await expect(
      streamChat('ctx', [{ role: 'user', content: 'Worth going?' }], () => {}, controller.signal),
    ).rejects.toThrow();
  });
});
