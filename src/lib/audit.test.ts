/**
 * The audit, and what `--fix` does about what it finds.
 *
 * Every fixture here is written straight into the collection rather than
 * through the store, because the store refuses all of it. That is the point of
 * the tool: it is for documents that arrived some other way — an earlier
 * schema, a half-finished migration, a delete that raced a write.
 */
import { ObjectId, MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyFixes, audit } from './audit';
import { CONDITIONS, ensureIndexes, SPOTS } from './indexes';
import { createSpot } from './spots';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await new MongoClient(mongod.getUri()).connect();
  db = client.db('tideline-test');
}, 180_000);

afterAll(async () => {
  await client?.close();
  await mongod?.stop();
});

beforeEach(async () => {
  await db.dropDatabase();
  await ensureIndexes(db);
});

/** The count for one check, by name. */
async function count(check: string): Promise<number> {
  const findings = await audit(db);
  const finding = findings.find((f) => f.check === check);
  if (!finding) throw new Error(`no such check: ${check}`);
  return finding.count;
}

/** Total across every check. */
async function total(): Promise<number> {
  return (await audit(db)).reduce((sum, f) => sum + f.count, 0);
}

/**
 * A spot written past the store, so it can be as wrong as the test needs.
 *
 * Pass `location: null` to leave the field off entirely. That is not a
 * convenience: the 2dsphere index validates what it indexes, so a coordinate
 * off the planet is only insertable with no point beside it, which is exactly
 * how such a document turns up in real life.
 */
async function rawSpot(over: Record<string, unknown>) {
  const lat = (over.lat as number) ?? -33.89;
  const lon = (over.lon as number) ?? 151.27;
  const doc: Record<string, unknown> = {
    _id: new ObjectId(),
    name: 'Raw',
    lat,
    lon,
    location: { type: 'Point', coordinates: [lon, lat] },
    createdAt: new Date(),
    ...over,
  };
  if (doc.location === null) delete doc.location;
  await db.collection(SPOTS).insertOne(doc);
  return doc._id as ObjectId;
}

async function rawSnapshot(spotId: ObjectId, at: Date) {
  await db.collection(CONDITIONS).insertOne({
    _id: new ObjectId(),
    spotId,
    at,
    capturedAt: new Date(),
    tz: '+10:00',
    score: 50,
    unfishable: false,
    factors: { tide: 0.5, wind: 0.5, wave: 0.5, rain: 0.5 },
    windKn: 10,
    gustKn: 14,
    waveM: 0.5,
    tideRate: 0.2,
    rainMm: 0,
  });
}

describe('a store with nothing wrong with it', () => {
  it('reports every check clean', async () => {
    const spot = await createSpot(db, { lat: -33.8908, lon: 151.2743 });
    await rawSnapshot(new ObjectId(spot.id), new Date());

    expect(await total()).toBe(0);
  });

  it('names every check it ran, so a clean report still says what was looked at', async () => {
    expect((await audit(db)).map((f) => f.check)).toEqual([
      'near-duplicate spots',
      'orphan snapshots',
      'coordinates off the planet',
      'location out of step',
      'precision drift',
    ]);
  });
});

describe('near-duplicate spots', () => {
  it('finds two taps at the same place that the unique index cannot', async () => {
    // 20 m apart: two different 4dp pairs, so the index is satisfied and they
    // are two spots as far as the store is concerned.
    await createSpot(db, { lat: -33.8908, lon: 151.2743, name: 'First' });
    await createSpot(db, { lat: -33.891, lon: 151.2744, name: 'Second' });

    expect(await count('near-duplicate spots')).toBe(1);
  });

  it('leaves genuinely separate spots alone', async () => {
    await createSpot(db, { lat: -33.8908, lon: 151.2743, name: 'Bondi' });
    await createSpot(db, { lat: -33.7969, lon: 151.2873, name: 'Manly' });

    expect(await count('near-duplicate spots')).toBe(0);
  });

  it('merges into the oldest and moves its snapshots across', async () => {
    const first = await createSpot(db, { lat: -33.8908, lon: 151.2743, name: 'First' });
    const second = await createSpot(db, { lat: -33.891, lon: 151.2744, name: 'Second' });
    await rawSnapshot(new ObjectId(second.id), new Date('2026-09-20T00:00:00Z'));

    await applyFixes(db);

    const left = await db.collection(SPOTS).find().toArray();
    expect(left.map((s) => s.name)).toEqual(['First']);
    expect(await db.collection(CONDITIONS).countDocuments({ spotId: new ObjectId(first.id) })).toBe(1);
    expect(await count('near-duplicate spots')).toBe(0);
  });

  it('drops the loser’s copy of an hour the keeper already holds', async () => {
    // (spotId, at) is unique, so repointing that hour would violate the index.
    // The keeper's reading is the one to believe: it is the spot that survives.
    const hour = new Date('2026-09-20T00:00:00Z');
    const first = await createSpot(db, { lat: -33.8908, lon: 151.2743, name: 'First' });
    const second = await createSpot(db, { lat: -33.891, lon: 151.2744, name: 'Second' });
    await rawSnapshot(new ObjectId(first.id), hour);
    await rawSnapshot(new ObjectId(second.id), hour);
    await rawSnapshot(new ObjectId(second.id), new Date('2026-09-20T01:00:00Z'));

    await applyFixes(db);

    expect(await db.collection(CONDITIONS).countDocuments()).toBe(2);
    expect(await total()).toBe(0);
  });
});

describe('orphan snapshots', () => {
  it('finds hours whose spot has been deleted out from under them', async () => {
    const gone = new ObjectId();
    await rawSnapshot(gone, new Date('2026-09-20T00:00:00Z'));
    await rawSnapshot(gone, new Date('2026-09-20T01:00:00Z'));

    expect(await count('orphan snapshots')).toBe(2);
  });

  it('deletes them', async () => {
    await rawSnapshot(new ObjectId(), new Date('2026-09-20T00:00:00Z'));

    await applyFixes(db);

    expect(await db.collection(CONDITIONS).countDocuments()).toBe(0);
  });
});

describe('coordinates off the planet', () => {
  it('finds them', async () => {
    await rawSpot({ lat: 200, lon: 151.27, name: 'Nowhere', location: null });
    expect(await count('coordinates off the planet')).toBe(1);
  });

  it('does not try to fix them, because there is no right answer', async () => {
    await rawSpot({ lat: 200, lon: 151.27, name: 'Nowhere', location: null });

    const finding = (await audit(db)).find((f) => f.check === 'coordinates off the planet');
    expect(finding?.fixable).toBe(false);

    await applyFixes(db);
    expect(await count('coordinates off the planet')).toBe(1);
  });

  it('is not also reported as a missing point, which could not be rebuilt', async () => {
    // A 2dsphere index would refuse the write, so flagging it as fixable would
    // promise a repair that throws.
    await rawSpot({ lat: 200, lon: 151.27, name: 'Nowhere', location: null });

    expect(await count('location out of step')).toBe(0);
  });
});

describe('location out of step', () => {
  it('finds a GeoJSON point that disagrees with lat/lon', async () => {
    // Transposed, which is the way this goes wrong: GeoJSON is [lon, lat].
    // Both orderings have to be valid points for the document to exist at all,
    // so this one is nowhere near Australia.
    await rawSpot({ lat: 20, lon: 10, location: { type: 'Point', coordinates: [20, 10] } });

    expect(await count('location out of step')).toBe(1);
  });

  it('finds one that is missing entirely, the way an older schema left them', async () => {
    await rawSpot({ name: 'Old schema', location: null });

    expect(await count('location out of step')).toBe(1);
  });

  it('rebuilds it from lat/lon', async () => {
    await rawSpot({ lat: -33.89, lon: 151.27, location: { type: 'Point', coordinates: [0, 0] } });

    await applyFixes(db);

    const spot = await db.collection(SPOTS).findOne({});
    expect(spot?.location).toEqual({ type: 'Point', coordinates: [151.27, -33.89] });
    expect(await count('location out of step')).toBe(0);
  });
});

describe('precision drift', () => {
  it('finds coordinates stored finer than the map can produce', async () => {
    await rawSpot({ lat: -33.890812, lon: 151.274357 });
    expect(await count('precision drift')).toBe(1);
  });

  it('rounds them to 4dp', async () => {
    await rawSpot({ lat: -33.890812, lon: 151.274357 });

    await applyFixes(db);

    const spot = await db.collection(SPOTS).findOne({});
    expect(spot).toMatchObject({ lat: -33.8908, lon: 151.2744 });
    // The GeoJSON point has to follow, or the next audit flags it instead.
    expect(spot?.location.coordinates).toEqual([151.2744, -33.8908]);
  });

  it('hands a rounding that collides to the merge pass rather than guessing', async () => {
    // Rounding the second one lands it exactly on the first, which the unique
    // index refuses. Both are then the same place, so the merge is the answer.
    await rawSpot({ lat: -33.8908, lon: 151.2743, name: 'Exact', createdAt: new Date(1) });
    await rawSpot({ lat: -33.89081234, lon: 151.27431, name: 'Drifted', createdAt: new Date(2) });

    await applyFixes(db);

    const left = await db.collection(SPOTS).find().toArray();
    expect(left).toHaveLength(1);
    expect(left[0].name).toBe('Exact');
    expect(await total()).toBe(0);
  });
});

describe('applyFixes', () => {
  it('says what it did', async () => {
    await rawSpot({ lat: -33.890812, lon: 151.274357 });
    await rawSnapshot(new ObjectId(), new Date());

    const done = await applyFixes(db);

    expect(done.map((r) => r.check)).toContain('precision drift');
    expect(done.map((r) => r.check)).toContain('orphan snapshots');
  });

  it('leaves a clean store alone', async () => {
    await createSpot(db, { lat: -33.8908, lon: 151.2743 });
    expect(await applyFixes(db)).toEqual([]);
  });
});
