/**
 * Asking Claude about the spot you are looking at.
 *
 * The key is never handed to the page. The renderer posts the forecast it is
 * already showing plus the question, and this route is the only thing that
 * talks to Anthropic — which is also why the route exists at all, rather than
 * the app calling that API directly the way it calls Open-Meteo.
 *
 * The client is injected rather than constructed here: a null one is a build
 * with no key configured, which the renderer reads as "this feature is not in
 * this build" and hides, and a test passes a fake and never leaves the process.
 */

import { HttpError } from './http';

/**
 * Sonnet rather than Opus: the questions are "is tomorrow morning worth it"
 * over two days of numbers already laid out in the prompt, which is not work
 * that repays five times the token price.
 */
export const MODEL = 'claude-sonnet-5';

/**
 * A hard ceiling on what one answer can cost. Thinking tokens count against
 * it too, so this is not purely reply length — but a chat turn that wants
 * more than this has misunderstood the question.
 */
const MAX_TOKENS = 4000;

/** Transcript limits, so a long session cannot quietly grow into a large bill. */
export const MAX_TURNS = 20;
export const MAX_MESSAGE_CHARS = 2000;
export const MAX_CONTEXT_CHARS = 24000;

/** A chat turn carries two days of forecast, so it needs its own headroom. */
export const CHAT_BODY_LIMIT = 256 * 1024;

/**
 * Fixed, and deliberately free of anything that changes between requests —
 * the clock, the spot, the question. Everything volatile rides in the context
 * block after it, so this prefix stays byte-identical and stays cacheable.
 */
const SYSTEM_PROMPT = `You are the assistant inside Tideline, an app that shows wind, swell, tide and rain for Australian coastal fishing spots and scores how the fishing looks.

The block after this one holds the forecast for the spot the user is looking at right now: the current conditions, the score and what drove it, every hour for the next two days, the tide turns, and the best windows. Answer from that data and nothing else. Never invent a number, and when the data does not cover what was asked — a different spot, a date past the forecast, what species are biting — say so plainly instead of guessing.

Answer first, then the reason. Most questions deserve two or three sentences. Quote the times and figures that decide the answer, in the units the data uses: knots for wind, metres for swell and tide, millimetres for rain. Every time is local to the spot.

How the score is built, so you can explain one rather than restate it:
- Five factors, weighted: the tide's position between turns (heaviest), wind strength, swell read against the direction it comes from, the weather, and wind direction (lightest). A third of the way through a run of tide is the best of it; slack water at the top or bottom is the worst. A westerly is offshore here and scores a little better than an easterly, but which way that cuts depends on the bank, so it only ever breaks a tie.
- Only the hours around first and last light can reach Prime. Everywhere else the score is held to 74 however good the conditions are, so a flawless midday hour reading 74 is the cap, not a coincidence. Say so if it comes up.
- Midnight to four in the morning is docked ten points on top of that. It is a discouragement from fishing the small hours rather than a claim about the fish, so if someone asks about 2am, tell them the conditions themselves and that the score carries that deduction.

What the data cannot tell you, and what to say when it matters:
- Tides are modelled globally rather than taken from Australian tide tables, so turns can run 20-40 minutes out, and heights are against mean sea level rather than the chart datum BOM publishes.
- The wave model resolves about 9 km, so harbours and water behind a breakwall fish calmer than the swell figure suggests.
- Anyone planning a trip should check BOM before they go.

Never tell someone conditions are safe. Above roughly 25 knots, or 3 metres of swell, say the conditions are dangerous for shore and small-boat fishing and leave the decision with them. You know nothing about their boat, their experience, or the ground they are standing on.

Write plain prose. No markdown, no headings, no bullet lists — the reply is rendered as plain text.`;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** What a finished stream reports about why it stopped. */
interface FinalMessage {
  stop_reason?: string | null;
}

/**
 * The slice of the Anthropic SDK this module uses.
 *
 * Structural rather than imported: the SDK is loaded lazily and only when a
 * key exists, and a test's fake implements exactly these three members.
 */
export interface ChatStream {
  on(event: 'text', handler: (delta: string) => void): unknown;
  abort(): void;
  finalMessage(): Promise<FinalMessage>;
}

export interface ChatClient {
  messages: { stream(params: Record<string, unknown>): ChatStream };
}

/**
 * The transcript has to be a shape the API accepts, and the checks live here
 * rather than in the client because the client is not the only thing that can
 * post to this route.
 */
function validate(body: unknown): { context: string; messages: ChatMessage[] } {
  const { context, messages } = (body ?? {}) as { context?: unknown; messages?: unknown };

  if (typeof context !== 'string' || context.trim() === '') {
    throw new HttpError(400, 'No forecast to answer from.');
  }
  if (context.length > MAX_CONTEXT_CHARS) {
    throw new HttpError(400, 'That forecast is too large to send.');
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new HttpError(400, 'Ask a question first.');
  }
  if (messages.length > MAX_TURNS) {
    throw new HttpError(400, 'This conversation has run long. Pick the spot again to start over.');
  }
  // user, assistant, user, ... and ending on the user: the API rejects any
  // other ordering, so it is worth failing here with a sentence rather than
  // there with a 400 nobody can read.
  if (messages.length % 2 === 0) {
    throw new HttpError(400, 'Malformed conversation.');
  }

  messages.forEach((message: unknown, i: number) => {
    const turn = message as ChatMessage | null;
    const expected = i % 2 === 0 ? 'user' : 'assistant';
    if (turn?.role !== expected || typeof turn.content !== 'string') {
      throw new HttpError(400, 'Malformed conversation.');
    }
    if (turn.content.trim() === '') {
      throw new HttpError(400, 'Ask a question first.');
    }
    if (turn.content.length > MAX_MESSAGE_CHARS) {
      throw new HttpError(400, `Keep the question under ${MAX_MESSAGE_CHARS} characters.`);
    }
  });

  return { context, messages: messages as ChatMessage[] };
}

/**
 * Maps an SDK failure onto something the panel can show.
 *
 * Only the cases a user can act on get their own words; everything else is a
 * 502 with no detail, because the detail is ours and tends to quote the
 * request we sent.
 */
function describeFailure(err: unknown): { status: number; error: string } {
  const status = (err as { status?: number } | null)?.status;
  if (status === 429) {
    return { status: 429, error: 'Too many questions at once. Give it a moment.' };
  }
  if (status === 401 || status === 403) {
    return { status: 502, error: 'The Claude key this build was given was refused.' };
  }
  if (status === 400) {
    return { status: 400, error: 'That question could not be sent.' };
  }
  return { status: 502, error: 'Could not reach Claude. Try again in a moment.' };
}

/**
 * The SDK reports text through a callback and completion through a promise.
 * Reading one chunk at a time needs both funnelled into the same place, which
 * is the only reason this exists.
 */
function drain(stream: ChatStream) {
  const chunks: string[] = [];
  let settled: { message?: FinalMessage; error?: unknown } | null = null;
  let wake: (() => void) | null = null;

  const bump = () => {
    const resume = wake;
    wake = null;
    resume?.();
  };

  stream.on('text', (delta) => {
    chunks.push(delta);
    bump();
  });

  void stream.finalMessage().then(
    (message) => {
      settled = { message };
      bump();
    },
    (error) => {
      settled = { error };
      bump();
    },
  );

  return {
    /** The next chunk of text, or null once the stream has settled and drained. */
    async next(): Promise<string | null> {
      for (;;) {
        const chunk = chunks.shift();
        if (chunk !== undefined) return chunk;
        if (settled) return null;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
    outcome: (): { message?: FinalMessage; error?: unknown } | null => settled,
  };
}

/**
 * One answer, as a streaming response.
 *
 * The first chunk is awaited before the `Response` is built, which is what
 * preserves the rule the Express version kept with `flushHeaders`: a failure
 * that happens before any text exists is still a JSON error with a status,
 * rather than a 200 carrying an apology in its body. Once a token has gone out
 * it is too late for a status code, so later failures are appended to the text
 * the reader is already looking at.
 */
export async function streamAnswer(
  client: ChatClient | null,
  body: unknown,
  model: string = MODEL,
): Promise<Response> {
  if (client === null) {
    return Response.json(
      { error: 'This build has no Claude key configured, so there is nothing to ask.' },
      { status: 503 },
    );
  }

  const request = validate(body);

  const stream = client.messages.stream({
    model,
    max_tokens: MAX_TOKENS,
    // Adaptive thinking at low effort: weighing a few hours against each
    // other wants some reasoning, but not the deep kind, and thinking is
    // billed as output.
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    system: [
      { type: 'text', text: SYSTEM_PROMPT },
      // The breakpoint sits after the forecast, so a follow-up about the
      // same spot re-reads both blocks from cache instead of paying for
      // them again.
      { type: 'text', text: request.context, cache_control: { type: 'ephemeral' } },
    ],
    messages: request.messages,
  });

  const source = drain(stream);
  const first = await source.next();

  if (first === null) {
    const outcome = source.outcome();
    if (outcome?.error) {
      const { status, error } = describeFailure(outcome.error);
      if (status >= 500) console.error('[tideline/chat]', outcome.error);
      return Response.json({ error }, { status });
    }
  }

  const encoder = new TextEncoder();
  const text = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (first !== null) controller.enqueue(encoder.encode(first));

      for (;;) {
        const chunk = await source.next();
        if (chunk === null) break;
        controller.enqueue(encoder.encode(chunk));
      }

      const outcome = source.outcome();
      if (outcome?.error) {
        controller.enqueue(encoder.encode('\n\n(the answer was cut short)'));
      } else if (outcome?.message?.stop_reason === 'refusal') {
        // A refusal arrives as an ordinary 200 carrying little or no text,
        // which would otherwise read as the app having silently broken.
        controller.enqueue(
          encoder.encode('\n\nClaude declined to answer that one. Try asking about the conditions.'),
        );
      } else if (outcome?.message?.stop_reason === 'max_tokens') {
        controller.enqueue(encoder.encode('\n\n(cut off — ask something narrower)'));
      }

      controller.close();
    },

    // Closing the tab mid-answer should stop the meter, not keep generating
    // tokens nobody will read. This fires when the reader goes away, and not
    // on a stream that ran to completion.
    cancel() {
      stream.abort();
    },
  });

  return new Response(text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      // Without this a proxy may hold the whole answer back and hand it over
      // at once, which is the one thing streaming was for.
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * A client from `ANTHROPIC_API_KEY`, or null when there is no key to use.
 *
 * Both routes that expose the feature go through this, so "is the panel in
 * this build" has one answer rather than two that can drift. The import is
 * deferred because the SDK is only a dependency of this one feature, and a
 * build without a key should not pay to load it.
 */
export async function anthropicFromEnv(): Promise<ChatClient | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  const { Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: key }) as unknown as ChatClient;
}
