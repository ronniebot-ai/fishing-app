/**
 * The API through its route handlers. The store's rules are pinned down in
 * src/lib/spots.test.ts; what matters here is the translation — which status
 * code each outcome becomes, and that an error carries a message the UI can
 * show.
 *
 * The handlers are called directly rather than over a socket. A route handler
 * reads nothing but its `Request`, so there is no server to start and no port
 * to pick, which is what the Express version needed an ephemeral one for.
 *
 * MONGODB_URI is pointed at a mongod running in memory, so these go through
 * the same `getDb` the deployed routes use, connection cache and all.
 */
import { MongoClient, type MongoClient as Client } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureIndexes } from '../../../lib/indexes';
import { POST as RECORD } from './[id]/conditions/route';
import { DELETE, PATCH } from './[id]/route';
import { GET as STATS } from './[id]/stats/route';
import { GET as NEARBY } from './nearby/route';
import { GET, POST } from './route';

const BONDI = { lat: -33.8908, lon: 151.2743 };
const ORIGIN = 'http://tideline.test';
const DB = 'tideline-test';

/** A well-formed id that was never saved. */
const ABSENT = '65f0a1b2c3d4e5f6000000ff';

let mongod: MongoMemoryServer;
let client: Client;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB = DB;
  client = await new MongoClient(mongod.getUri()).connect();
}, 180_000);

afterAll(async () => {
  await client?.close();
  // The pool `getDb` opened and cached, which nothing else will close.
  const cached = (globalThis as { __tidelineMongo?: Promise<Client> }).__tidelineMongo;
  await (await cached)?.close();
  await mongod?.stop();
});

beforeEach(async () => {
  const db = client.db(DB);
  await db.dropDatabase();
  await ensureIndexes(db);
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

/** Saves a spot and hands back the id the store gave it. */
async function save(body: unknown = BONDI): Promise<string> {
  return (await read(await post(body))).body.id;
}

const MANLY = { lat: -33.7969, lon: 151.2873 };

/** One hour of readings, as the page sends them. */
function hour(at: string, score = 60) {
  return {
    at,
    score,
    unfishable: false,
    factors: { tide: 0.8, wind: 0.6, wave: 0.5, rain: 1 },
    windKn: 12,
    gustKn: 18,
    waveM: 0.8,
    tideRate: 0.3,
    rainMm: 0,
  };
}

function recordHours(id: string, hours: unknown[]) {
  return RECORD(
    new Request(`${ORIGIN}/api/spots/${id}/conditions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ utcOffsetSeconds: 10 * 3600, hours }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function stats(id: string, query = '') {
  return STATS(new Request(`${ORIGIN}/api/spots/${id}/stats${query}`), {
    params: Promise.resolve({ id }),
  });
}

function nearby(query: string) {
  return NEARBY(new Request(`${ORIGIN}/api/spots/nearby${query}`));
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
    expect(res.body).toMatchObject({ name: 'Spot 1', ...BONDI });
    expect(res.body.id).toMatch(/^[0-9a-f]{24}$/);
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
    const id = await save();

    expect(await read(await patch(id, { name: 'The wall' }))).toMatchObject({
      status: 200,
      body: { id, name: 'The wall' },
    });
  });

  it('404s on an id that was never saved', async () => {
    expect(await read(await patch(ABSENT, { name: 'x' }))).toMatchObject({ status: 404 });
  });

  it('400s on an id the store could never have issued', async () => {
    expect(await read(await patch('abc', { name: 'x' }))).toMatchObject({ status: 400 });
  });
});

describe('DELETE /api/spots/:id', () => {
  it('deletes with 204 and no body', async () => {
    const id = await save();

    expect(await read(await remove(id))).toMatchObject({ status: 204, body: null });
    expect((await read(await GET())).body).toEqual([]);
  });

  it('404s on an id that was never saved', async () => {
    expect(await read(await remove(ABSENT))).toMatchObject({ status: 404 });
  });
});

describe('POST /api/spots/:id/conditions', () => {
  it('accepts a batch with 202 and says what it did with it', async () => {
    const id = await save();

    const res = await read(await recordHours(id, [hour('2026-09-20T00:00:00.000Z')]));

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ received: 1, inserted: 1, updated: 0 });
  });

  it('updates an hour it already holds instead of keeping two', async () => {
    const id = await save();
    await recordHours(id, [hour('2026-09-20T00:00:00.000Z', 40)]);

    const res = await read(await recordHours(id, [hour('2026-09-20T00:00:00.000Z', 72)]));

    expect(res.body).toMatchObject({ received: 1, inserted: 0, updated: 1 });
  });

  it('404s for a spot that is not there', async () => {
    expect(await read(await recordHours(ABSENT, [hour('2026-09-20T00:00:00.000Z')]))).toMatchObject({
      status: 404,
    });
  });

  it('400s on a body that is not a batch of hours', async () => {
    const id = await save();
    expect(await read(await recordHours(id, 'lots' as unknown as unknown[]))).toMatchObject({
      status: 400,
    });
  });
});

describe('GET /api/spots/:id/stats', () => {
  it('answers with the shape the panel reads, even with no history', async () => {
    const id = await save();

    const res = await read(await stats(id));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ samples: 0, days: 30, byHour: [], factors: null });
  });

  it('summarises the hours it has been sent', async () => {
    const id = await save();
    const recent = new Date(Date.now() - 3 * 3600_000).toISOString();
    await recordHours(id, [hour(recent, 82)]);

    const res = await read(await stats(id));

    expect(res.body.samples).toBe(1);
    expect(res.body.byHour).toHaveLength(1);
    expect(res.body.factors).toMatchObject({ tide: 0.8, wind: 0.6 });
  });

  it('takes the window from the query string', async () => {
    const id = await save();
    expect((await read(await stats(id, '?days=7'))).body.days).toBe(7);
  });

  it.each([
    ['an id the store could not have issued', 'abc', ''],
    ['a window of no days', ABSENT, '?days=0'],
  ])('400s on %s', async (_label, id, query) => {
    expect(await read(await stats(id, query))).toMatchObject({ status: 400 });
  });
});

describe('GET /api/spots/nearby', () => {
  it('returns saved spots nearest first, with a distance', async () => {
    await post({ ...BONDI, name: 'Bondi' });
    await post({ ...MANLY, name: 'Manly' });

    const res = await read(await nearby(`?lat=${BONDI.lat}&lon=${BONDI.lon}&km=50`));

    expect(res.status).toBe(200);
    expect(res.body.map((s: { name: string }) => s.name)).toEqual(['Bondi', 'Manly']);
    expect(res.body[0].distanceM).toBe(0);
    expect(res.body[1].distanceM).toBeGreaterThan(9_000);
  });

  it('leaves out anything past the radius', async () => {
    await post({ ...BONDI, name: 'Bondi' });
    await post({ ...MANLY, name: 'Manly' });

    const res = await read(await nearby(`?lat=${BONDI.lat}&lon=${BONDI.lon}&km=5`));

    expect(res.body.map((s: { name: string }) => s.name)).toEqual(['Bondi']);
  });

  it('defaults the radius when none is given', async () => {
    await post({ ...BONDI, name: 'Bondi' });
    expect((await read(await nearby(`?lat=${BONDI.lat}&lon=${BONDI.lon}`))).body).toHaveLength(1);
  });

  it('400s without a point to search from', async () => {
    expect(await read(await nearby('?km=10'))).toMatchObject({ status: 400 });
  });
});
