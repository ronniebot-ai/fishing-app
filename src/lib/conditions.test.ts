/**
 * Snapshots and the two aggregations that read them.
 *
 * Three things here are worth more than the rest: that re-sending an hour
 * updates it instead of duplicating it, that the hour-of-day grouping happens
 * in the spot's own time rather than the server's, and that `$geoNear` orders
 * by real distance rather than by degrees.
 */
import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  conditions,
  nearbySpots,
  offsetToTz,
  recordSnapshots,
  spotStats,
} from './conditions';
import { ensureIndexes } from './indexes';
import { createSpot } from './spots';

const BONDI = { lat: -33.8908, lon: 151.2743 };
const MANLY = { lat: -33.7969, lon: 151.2873 }; // ~10.5 km from Bondi
const NEWCASTLE = { lat: -32.9283, lon: 151.7817 }; // ~115 km from Bondi

/** Sydney. Every hour below is written with this offset unless said otherwise. */
const SYDNEY_OFFSET = 10 * 3600;

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

/** An hour of readings, with everything but the interesting bits defaulted. */
function hour(at: string, over: Record<string, unknown> = {}) {
  return {
    at,
    score: 60,
    unfishable: false,
    factors: { tide: 0.8, wind: 0.6, wave: 0.5, weather: 1, windDir: 0.7 },
    windKn: 12,
    gustKn: 18,
    waveM: 0.8,
    tideRate: 0.3,
    rainMm: 0,
    ...over,
  };
}

async function record(spotId: string, hours: unknown[], utcOffsetSeconds = SYDNEY_OFFSET) {
  return recordSnapshots(db, spotId, { utcOffsetSeconds, hours });
}

describe('offsetToTz', () => {
  it.each([
    ['Sydney', 10 * 3600, '+10:00'],
    ['UTC', 0, '+00:00'],
    ['Adelaide, on a half hour', 9.5 * 3600, '+09:30'],
    ['Chatham, on a quarter', 12.75 * 3600, '+12:45'],
    ['west of Greenwich', -3.5 * 3600, '-03:30'],
  ])('renders %s', (_label, seconds, expected) => {
    expect(offsetToTz(seconds)).toBe(expected);
  });
});

describe('recordSnapshots', () => {
  it('writes the hours it is given', async () => {
    const { id } = await createSpot(db, BONDI);

    const result = await record(id, [
      hour('2026-09-20T00:00:00.000Z'),
      hour('2026-09-20T01:00:00.000Z'),
    ]);

    expect(result).toEqual({ received: 2, inserted: 2, updated: 0 });
    expect(await conditions(db).countDocuments()).toBe(2);
  });

  it('updates an hour it already holds rather than keeping two of it', async () => {
    // The app re-sends overlapping windows every time a spot is opened, so
    // this is the ordinary case, not an edge one. The unique index over
    // (spotId, at) is what makes the upsert land on the same document.
    const { id } = await createSpot(db, BONDI);
    await record(id, [hour('2026-09-20T00:00:00.000Z', { score: 40 })]);

    const second = await record(id, [hour('2026-09-20T00:00:00.000Z', { score: 72 })]);

    expect(second).toMatchObject({ received: 1, inserted: 0, updated: 1 });
    expect(await conditions(db).countDocuments()).toBe(1);
    expect((await conditions(db).findOne({}))?.score).toBe(72);
  });

  it('keeps one spot’s hours apart from another’s', async () => {
    const bondi = await createSpot(db, BONDI);
    const manly = await createSpot(db, MANLY);

    await record(bondi.id, [hour('2026-09-20T00:00:00.000Z')]);
    await record(manly.id, [hour('2026-09-20T00:00:00.000Z')]);

    expect(await conditions(db).countDocuments()).toBe(2);
  });

  it('takes an empty batch without a round trip to the database', async () => {
    const { id } = await createSpot(db, BONDI);
    expect(await record(id, [])).toEqual({ received: 0, inserted: 0, updated: 0 });
  });

  it('404s for a spot that is not there, so orphans cannot be created', async () => {
    await expect(record('65f0a1b2c3d4e5f6000000ff', [hour('2026-09-20T00:00:00.000Z')]))
      .rejects.toThrowError(expect.objectContaining({ status: 404 }));
  });

  it.each([
    ['hours that are not an array', { hours: 'lots' }],
    ['an hour with no timestamp', { hours: [{ score: 50 }] }],
    ['a score off the scale', { hours: [{ at: '2026-09-20T00:00:00.000Z', score: 140 }] }],
    [
      'a factor outside 0-1',
      { hours: [{ at: '2026-09-20T00:00:00.000Z', score: 50, factors: { tide: 4 } }] },
    ],
    ['more hours than a forecast could hold', { hours: Array.from({ length: 201 }, () => hour('2026-09-20T00:00:00.000Z')) }],
  ])('400s on %s', async (_label, body) => {
    const { id } = await createSpot(db, BONDI);
    await expect(recordSnapshots(db, id, { utcOffsetSeconds: SYDNEY_OFFSET, ...body }))
      .rejects.toThrowError(expect.objectContaining({ status: 400 }));
  });
});

describe('spotStats', () => {
  it('groups the hours in the spot’s own time, not the server’s', async () => {
    // 20:00 UTC is 06:00 the next morning in Sydney. Grouping in UTC would
    // file this under 20, which for a fishing app is the difference between
    // "dawn" and "after dinner".
    const { id } = await createSpot(db, BONDI);
    await record(id, [hour(isoHoursAgo(20, '20:00'), { score: 90 })]);

    const stats = await spotStats(db, id);

    expect(stats.byHour).toHaveLength(1);
    expect(stats.byHour[0]).toMatchObject({ hour: 6, avgScore: 90, bestScore: 90, samples: 1 });
  });

  it('averages every sample that falls in the same local hour', async () => {
    const { id } = await createSpot(db, BONDI);
    await record(id, [
      hour(isoHoursAgo(30, '20:00'), { score: 80 }),
      hour(isoHoursAgo(6, '20:00'), { score: 40 }),
    ]);

    const [six] = (await spotStats(db, id)).byHour;
    expect(six).toMatchObject({ hour: 6, avgScore: 60, bestScore: 80, samples: 2 });
  });

  it.each([
    ['the bottom of a band', 20, { from: 20, to: 39 }],
    ['the top of a band', 19, { from: 0, to: 19 }],
    ['a perfect score, which the last boundary has to include', 100, { from: 80, to: 100 }],
  ])('buckets %s correctly', async (_label, score, band) => {
    const { id } = await createSpot(db, BONDI);
    await record(id, [hour(isoHoursAgo(4), { score })]);

    const { distribution } = await spotStats(db, id);
    const filled = distribution.filter((b) => b.samples > 0);

    expect(filled).toHaveLength(1);
    expect(filled[0]).toMatchObject({ ...band, samples: 1 });
  });

  it('averages the factors and counts the hours the gates ruled out', async () => {
    const { id } = await createSpot(db, BONDI);
    await record(id, [
      hour(isoHoursAgo(4), { factors: { tide: 1, wind: 0.4, wave: 0.6, weather: 1, windDir: 0.7 } }),
      hour(isoHoursAgo(5), { factors: { tide: 0, wind: 0.6, wave: 0.4, weather: 0, windDir: 0.7 }, unfishable: true }),
    ]);

    const stats = await spotStats(db, id);

    expect(stats.factors).toEqual({ tide: 0.5, wind: 0.5, wave: 0.5, weather: 0.5, windDir: 0.7 });
    expect(stats.unfishableShare).toBe(0.5);
    expect(stats.samples).toBe(2);
  });

  it('reads only as far back as it was asked to', async () => {
    const { id } = await createSpot(db, BONDI);
    await record(id, [hour(isoDaysAgo(2)), hour(isoDaysAgo(40))]);

    expect((await spotStats(db, id, 7)).samples).toBe(1);
    expect((await spotStats(db, id, 90)).samples).toBe(2);
  });

  it('answers with an empty shape rather than nothing when there is no history', async () => {
    const { id } = await createSpot(db, BONDI);

    expect(await spotStats(db, id)).toMatchObject({
      samples: 0,
      byHour: [],
      factors: null,
      unfishableShare: 0,
    });
  });

  it.each([
    ['an id the store could not have issued', 'abc', 30],
    ['a window of no days', '65f0a1b2c3d4e5f6000000ff', 0],
    ['a window longer than the data could ever be', '65f0a1b2c3d4e5f6000000ff', 400],
  ])('400s on %s', async (_label, id, days) => {
    await expect(spotStats(db, id, days)).rejects.toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe('nearbySpots', () => {
  it('returns the nearest first, with real distances', async () => {
    await createSpot(db, { ...NEWCASTLE, name: 'Newcastle' });
    await createSpot(db, { ...MANLY, name: 'Manly' });
    await createSpot(db, { ...BONDI, name: 'Bondi' });

    const near = await nearbySpots(db, BONDI.lat, BONDI.lon, 200);

    expect(near.map((s) => s.name)).toEqual(['Bondi', 'Manly', 'Newcastle']);
    expect(near[0].distanceM).toBe(0);
    // Sydney harbour heads to Bondi is about ten and a half kilometres.
    expect(near[1].distanceM).toBeGreaterThan(9_000);
    expect(near[1].distanceM).toBeLessThan(12_000);
  });

  it('leaves out anything past the radius', async () => {
    await createSpot(db, { ...BONDI, name: 'Bondi' });
    await createSpot(db, { ...MANLY, name: 'Manly' });
    await createSpot(db, { ...NEWCASTLE, name: 'Newcastle' });

    const near = await nearbySpots(db, BONDI.lat, BONDI.lon, 5);

    expect(near.map((s) => s.name)).toEqual(['Bondi']);
  });

  it('carries the next forecast hour it holds for each spot', async () => {
    const bondi = await createSpot(db, { ...BONDI, name: 'Bondi' });
    await record(bondi.id, [
      hour(isoHoursAgo(-2), { score: 71 }), // two hours from now
      hour(isoHoursAgo(-9), { score: 33 }), // later still
    ]);

    const [spot] = await nearbySpots(db, BONDI.lat, BONDI.lon, 5);

    expect(spot.nextScore).toBe(71);
    expect(spot.nextAt).not.toBeNull();
  });

  it('ignores hours that have already been and gone', async () => {
    const bondi = await createSpot(db, { ...BONDI, name: 'Bondi' });
    await record(bondi.id, [hour(isoHoursAgo(3), { score: 99 })]);

    const [spot] = await nearbySpots(db, BONDI.lat, BONDI.lon, 5);

    expect(spot.nextScore ?? null).toBeNull();
  });

  it('answers with an empty list rather than failing when nothing is in range', async () => {
    await createSpot(db, { ...NEWCASTLE, name: 'Newcastle' });
    expect(await nearbySpots(db, BONDI.lat, BONDI.lon, 10)).toEqual([]);
  });

  it.each([
    ['a latitude past the pole', 91, 151, 25],
    ['a coordinate that is not a number', 'here', 151, 25],
    ['a radius of nothing', -33.8, 151.2, 0],
    ['a radius wider than the coast', -33.8, 151.2, 900],
  ])('400s on %s', async (_label, lat, lon, km) => {
    await expect(nearbySpots(db, lat, lon, km)).rejects.toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });
});

/** An instant `hours` ago, optionally forced to a given UTC wall clock. */
function isoHoursAgo(hours: number, utcClock?: string): string {
  const d = new Date(Date.now() - hours * 3600_000);
  if (utcClock) {
    const [hh, mm] = utcClock.split(':').map(Number);
    d.setUTCHours(hh, mm, 0, 0);
  }
  return d.toISOString();
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600_000).toISOString();
}
