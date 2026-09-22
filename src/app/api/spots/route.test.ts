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
import { DELETE, PATCH } from './[id]/route';
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
