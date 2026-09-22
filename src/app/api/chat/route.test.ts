/**
 * The chat route against a fake Anthropic client.
 *
 * Nothing here calls Anthropic — what is worth pinning down is the translation
 * either side of it: that a build with no key says so instead of erroring,
 * that a malformed transcript is refused before a request is paid for, that
 * tokens reach the client as they are produced rather than in one lump at the
 * end, and that a refusal is visible rather than looking like silence.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatClient, ChatStream } from '../../../lib/chat';
import { streamAnswer } from '../../../lib/chat';
import { errorResponse } from '../../../lib/http';
import { GET, POST } from './route';

const CONTEXT = 'SPOT\nPosition: 33.8908°S 151.2743°E\n\nNOW\nScore 78/100 (Prime)';
const ASK = [{ role: 'user' as const, content: 'Is it worth going now?' }];

interface Fake extends ChatClient {
  sent: Record<string, unknown>[];
  state: { aborted: boolean };
}

/**
 * A stand-in for the SDK's MessageStream: the three things the route uses are
 * the `text` event, `finalMessage`, and `abort`.
 */
function fakeClient({
  chunks = ['Yes. '],
  stopReason = 'end_turn',
  failWith = null as unknown,
  failLate = false,
} = {}): Fake {
  const sent: Record<string, unknown>[] = [];
  const state = { aborted: false };

  return {
    sent,
    state,
    messages: {
      stream(params: Record<string, unknown>): ChatStream {
        sent.push(params);
        const listeners: ((delta: string) => void)[] = [];

        const stream: ChatStream = {
          on(event, fn) {
            if (event === 'text') listeners.push(fn);
            return stream;
          },
          abort() {
            state.aborted = true;
          },
          async finalMessage() {
            // `failLate` fails after the text has gone out, which is a
            // different code path: by then a 200 is already committed.
            if (failWith && !failLate) throw failWith;
            for (const chunk of chunks) {
              if (state.aborted) break;
              for (const fn of listeners) fn(chunk);
              // A real gap, not just a yield: chunks enqueued in the same tick
              // are handed over together, and then the reader on the other end
              // cannot tell a stream from a buffer either way.
              await new Promise((resolve) => setTimeout(resolve, 15));
            }
            if (failWith) throw failWith;
            return { stop_reason: stopReason };
          },
        };

        return stream;
      },
    },
  };
}

/**
 * What `POST /api/chat` does with the client it was handed — the route itself
 * is this plus `anthropicFromEnv`, which a test cannot inject through.
 */
async function ask(client: ChatClient | null, body: unknown) {
  let res: Response;
  try {
    res = await streamAnswer(client, body);
  } catch (err) {
    res = errorResponse(err);
  }

  const text = await res.text();
  let json: { error?: string } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // A streamed answer is plain text, not JSON — that is the success shape.
  }
  return { status: res.status, text, json };
}

const NO_KEY = { ...process.env };

afterEach(() => {
  process.env = { ...NO_KEY };
});

describe('a build with no key', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('reports itself unavailable rather than failing', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false, model: null });
  });

  it('refuses to answer, saying why in words the panel can show', async () => {
    const res = await POST(
      new Request('http://tideline.test/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: CONTEXT, messages: ASK }),
      }),
    );

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/no Claude key/i);
  });
});

describe('a build with a key', () => {
  it('names the model it will use', async () => {
    // Constructing the SDK client makes no request, so a stub key is enough to
    // prove the probe reports what a configured build would.
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

    expect(await (await GET()).json()).toEqual({ available: true, model: 'claude-sonnet-5' });
  });

  it('streams the answer as it is written, not in one piece at the end', async () => {
    const res = await streamAnswer(fakeClient({ chunks: ['Yes', ', ', 'about 3pm.'] }), {
      context: CONTEXT,
      messages: ASK,
    });

    expect(res.headers.get('content-type')).toMatch(/text\/plain/);

    const reads: string[] = [];
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      reads.push(decoder.decode(value));
    }

    // More than one read is the whole point: a buffered response would arrive
    // as a single chunk however many pieces it was written in.
    expect(reads.length).toBeGreaterThan(1);
    expect(reads.join('')).toBe('Yes, about 3pm.');
  });

  it('keeps generating until the end, rather than stopping at the first token', async () => {
    const client = fakeClient({ chunks: ['Yes', ', ', 'about 3pm.'] });

    expect((await ask(client, { context: CONTEXT, messages: ASK })).text).toBe('Yes, about 3pm.');
    expect(client.state.aborted).toBe(false);
  });

  it('stops generating when the reader walks away', async () => {
    const client = fakeClient({ chunks: ['Yes', ', ', 'about 3pm.'] });
    const res = await streamAnswer(client, { context: CONTEXT, messages: ASK });

    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(client.state.aborted).toBe(true);
  });

  it('sends the forecast as a cacheable block behind the fixed prompt', async () => {
    const client = fakeClient();
    await ask(client, { context: CONTEXT, messages: ASK });

    const [params] = client.sent;
    const system = params.system as { text: string; cache_control?: unknown }[];

    expect(params.model).toBe('claude-sonnet-5');
    expect(system[0].text).toMatch(/Tideline/);
    expect(system[0].cache_control).toBeUndefined();
    expect(system[1]).toMatchObject({ text: CONTEXT, cache_control: { type: 'ephemeral' } });
    expect(params.messages).toEqual(ASK);
  });

  it('says so when Claude declines, rather than answering with silence', async () => {
    const client = fakeClient({ chunks: [], stopReason: 'refusal' });

    expect((await ask(client, { context: CONTEXT, messages: ASK })).text).toMatch(/declined/i);
  });

  it('marks a truncated answer instead of letting it just stop', async () => {
    const client = fakeClient({ chunks: ['It depends'], stopReason: 'max_tokens' });

    expect((await ask(client, { context: CONTEXT, messages: ASK })).text).toMatch(/cut off/i);
  });

  it('turns a rate limit into words and a status the client can act on', async () => {
    const client = fakeClient({ failWith: Object.assign(new Error('slow down'), { status: 429 }) });

    const res = await ask(client, { context: CONTEXT, messages: ASK });
    expect(res.status).toBe(429);
    expect(res.json?.error).toMatch(/moment/i);
  });

  it('does not leak our own failure back to the page', async () => {
    const client = fakeClient({
      failWith: Object.assign(new Error('key sk-ant-123 bad'), { status: 500 }),
    });

    const res = await ask(client, { context: CONTEXT, messages: ASK });
    expect(res.status).toBe(502);
    expect(res.text).not.toMatch(/sk-ant/);
  });

  it('appends to the text already sent when the failure comes mid-answer', async () => {
    // Past the first token it is too late for a status code, so the only place
    // left to say anything is the stream the reader is already looking at.
    const client = fakeClient({
      chunks: ['Yes, ', 'about '],
      failWith: new Error('connection dropped'),
      failLate: true,
    });

    const res = await ask(client, { context: CONTEXT, messages: ASK });
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/cut short/i);
  });
});

describe('the transcript it will accept', () => {
  const refused: [string, unknown][] = [
    ['no forecast', { messages: ASK }],
    ['no question', { context: CONTEXT, messages: [] }],
    ['an empty question', { context: CONTEXT, messages: [{ role: 'user', content: '  ' }] }],
    [
      'a turn that is not the user’s',
      { context: CONTEXT, messages: [{ role: 'assistant', content: 'Yes.' }] },
    ],
    [
      'a transcript ending on the answer',
      { context: CONTEXT, messages: [...ASK, { role: 'assistant', content: 'Yes.' }] },
    ],
    [
      'a question longer than the field allows',
      { context: CONTEXT, messages: [{ role: 'user', content: 'x'.repeat(2001) }] },
    ],
    ['a forecast too large to be one', { context: 'x'.repeat(24001), messages: ASK }],
  ];

  it.each(refused)('refuses %s with a 400, before paying for a request', async (_name, body) => {
    const client = fakeClient();
    const res = await ask(client, body);

    expect(res.status).toBe(400);
    expect(res.json?.error).toBeTruthy();
    expect(client.sent).toHaveLength(0);
  });

  it('refuses a conversation past the turn limit', async () => {
    const client = fakeClient();
    const messages = Array.from({ length: 21 }, (_v, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'x',
    }));

    expect((await ask(client, { context: CONTEXT, messages })).status).toBe(400);
    expect(client.sent).toHaveLength(0);
  });

  it('takes a forecast far larger than a spot would ever be', async () => {
    // The spots routes cap a body at 8 kb; this one is the reason the chat
    // route carries a limit of its own.
    const context = 'hour line\n'.repeat(1200);
    expect(context.length).toBeGreaterThan(8 * 1024);

    expect((await ask(fakeClient(), { context, messages: ASK })).status).toBe(200);
  });
});
