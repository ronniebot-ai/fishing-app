/**
 * The shared edges of every route handler.
 *
 * Express did this with a four-argument error middleware and a body parser
 * mounted ahead of the routes. A route handler has neither, so the two jobs
 * live here and each handler wraps itself in them — which at least makes the
 * body limit visible at the route it applies to, rather than in a `use` call
 * three files away.
 */

/** An error carrying the status it should be answered with. */
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Reads and parses a JSON body, refusing one larger than `limitBytes`.
 *
 * A missing body resolves to `undefined` rather than throwing: the validators
 * downstream already reject it with a sentence about the field that is
 * missing, which is a better answer than "no body".
 */
export async function readJson(request: Request, limitBytes: number): Promise<unknown> {
  // The header is a claim, not a measurement, so it is only a cheap early out.
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limitBytes) {
    throw new HttpError(413, 'That request is too large.');
  }

  const text = await request.text();
  if (text === '') return undefined;
  if (new TextEncoder().encode(text).length > limitBytes) {
    throw new HttpError(413, 'That request is too large.');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Malformed JSON.');
  }
}

/**
 * Turns anything thrown by a handler into the response for it.
 *
 * A status below 500 is one we chose and phrased for the user, so it carries
 * its own message. Anything else is our bug: it is logged with its detail and
 * answered without, because the detail tends to quote the request.
 */
export function errorResponse(err: unknown): Response {
  const carried = (err as { status?: unknown } | null)?.status;
  const status = Number.isInteger(carried) && (carried as number) < 500 ? (carried as number) : 500;

  if (status === 500) console.error('[tideline/api]', err);

  return Response.json(
    { error: status === 500 ? 'Internal error.' : (err as Error).message },
    { status },
  );
}
