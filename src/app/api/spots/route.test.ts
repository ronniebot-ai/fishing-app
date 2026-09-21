/**
 * The API through its route handlers. The store's rules are pinned down in
 * src/lib/spots.test.ts; what matters here is the translation — which status
 * code each outcome becomes, and that an error carries a message the UI can
 * show.
 *
 * The handlers are called directly rather than over a socket. A route handler
 * reads nothing but its `Request`, so there is no server to start and no port
 * to pick, which is what the Express version needed an ephemeral one for.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DELETE, PATCH } from './[id]/route';
import { GET, POST } from './route';

const BONDI = { lat: -33.8908, lon: 151.2743 };
const ORIGIN = 'http://tideline.test';

beforeEach(() => {
  // The app's own override, pointed at a throwaway database. Clearing the
  // cached handle is what makes each test start from an empty one.
  process.env.TIDELINE_DB = ':memory:';
  delete (globalThis as { __tidelineDb?: unknown }).__tidelineDb;
});

/** Status plus parsed body, with 204 reported as the empty answer it is. */
async function read(res: Response) {
  return {
    status: res.status,
    body: res.status === 204 ? null : await res.json(),
  };
}

function post(body?: unknown, rawBody?: string) {
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  return POST(
    new Request(`${ORIGIN}/api/spots`, {
      method: 'POST',
      headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: payload,
    }),
  );
}

function patch(id: string, body: unknown) {
  return PATCH(
    new Request(`${ORIGIN}/api/spots/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function remove(id: string) {
  return DELETE(new Request(`${ORIGIN}/api/spots/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  });
}

describe('GET /api/spots', () => {
  it('starts empty', async () => {
    expect(await read(await GET())).toMatchObject({ status: 200, body: [] });
  });
});

describe('POST /api/spots', () => {
  it('creates with 201 and returns the saved spot', async () => {
    const res = await read(await post(BONDI));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, name: 'Spot 1', ...BONDI });
  });

  it('409s on a spot already saved, saying which one it is', async () => {
    await post({ ...BONDI, name: 'The wall' });
    const res = await read(await post(BONDI));

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/The wall/);
  });

  it('400s on coordinates that are not on the planet', async () => {
    expect(await read(await post({ lat: 900, lon: 0 }))).toMatchObject({ status: 400 });
  });

  it('400s on a body that is not JSON', async () => {
    const res = await read(await post(undefined, '{not json'));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Malformed JSON.');
  });

  it('400s rather than 500s when there is no body at all', async () => {
    expect(await read(await post())).toMatchObject({ status: 400 });
  });

  it('413s on a body far larger than a spot could be', async () => {
    // Express enforced this with a parser limit mounted ahead of the routes.
    // There is no such hook here, so the cap is applied in `readJson` and this
    // is what keeps it applied.
    const res = await read(await post({ ...BONDI, name: 'x'.repeat(9 * 1024) }));

    expect(res.status).toBe(413);
  });
});

describe('PATCH /api/spots/:id', () => {
  it('renames and returns the spot', async () => {
    await post(BONDI);

    expect(await read(await patch('1', { name: 'The wall' }))).toMatchObject({
      status: 200,
      body: { id: 1, name: 'The wall' },
    });
  });

  it('404s on an id that was never saved', async () => {
    expect(await read(await patch('7', { name: 'x' }))).toMatchObject({ status: 404 });
  });

  it('400s on an id that is not a number', async () => {
    expect(await read(await patch('abc', { name: 'x' }))).toMatchObject({ status: 400 });
  });
});

describe('DELETE /api/spots/:id', () => {
  it('deletes with 204 and no body', async () => {
    await post(BONDI);

    expect(await read(await remove('1'))).toMatchObject({ status: 204, body: null });
    expect((await read(await GET())).body).toEqual([]);
  });

  it('404s on an id that was never saved', async () => {
    expect(await read(await remove('7'))).toMatchObject({ status: 404 });
  });
});
