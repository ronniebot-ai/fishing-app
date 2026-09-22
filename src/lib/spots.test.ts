/**
 * The store's rules. The one worth reading twice is the naming: an unnamed
 * spot is given the lowest free number, not the next one, so deleting from the
 * middle of the list reuses that number rather than leaving a hole.
 *
 * Every test runs against a real mongod, in memory. The indexes are built the
 * same way the cluster's are, because one of them — the unique index over
 * (lat, lon) — is not an optimisation here but the thing that produces the 409.
 */
import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureIndexes } from './indexes';
import { createSpot, deleteSpot, listSpots, renameSpot, spots } from './spots';

const BONDI = { lat: -33.8908, lon: 151.2743 };
const MANLY = { lat: -33.7969, lon: 151.2873 };

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await new MongoClient(mongod.getUri()).connect();
  db = client.db('tideline-test');
  // The first run downloads a mongod binary; later ones start in about a second.
}, 180_000);

afterAll(async () => {
  await client?.close();
  await mongod?.stop();
});

beforeEach(async () => {
  await db.dropDatabase();
  await ensureIndexes(db);
});

describe('createSpot', () => {
  it('numbers unnamed spots from 1, in the order they were saved', async () => {
    expect((await createSpot(db, BONDI)).name).toBe('Spot 1');
    expect((await createSpot(db, MANLY)).name).toBe('Spot 2');
  });

  it('keeps a name the user typed', async () => {
    const spot = await createSpot(db, { ...BONDI, name: 'South end, off the rocks' });
    expect(spot.name).toBe('South end, off the rocks');
  });

  it('treats a blank name as no name', async () => {
    expect((await createSpot(db, { ...BONDI, name: '   ' })).name).toBe('Spot 1');
  });

  it('trims a name rather than storing the whitespace', async () => {
    expect((await createSpot(db, { ...BONDI, name: '  The wall  ' })).name).toBe('The wall');
  });

  it('fills the gap left by a delete instead of climbing', async () => {
    const first = await createSpot(db, BONDI);
    await createSpot(db, MANLY);
    await deleteSpot(db, first.id);

    expect((await createSpot(db, { lat: -32.0, lon: 152.0 })).name).toBe('Spot 1');
  });

  it('counts the numbers in use, not the rows', async () => {
    const first = await createSpot(db, BONDI); // Spot 1
    await renameSpot(db, first.id, { name: 'Spot 2' });

    // "Spot 2" is taken now, whoever took it, and "Spot 1" is free again.
    expect((await createSpot(db, MANLY)).name).toBe('Spot 1');
  });

  it('rounds coordinates to the 4dp the map hands out', async () => {
    const spot = await createSpot(db, { lat: -33.89081234, lon: 151.27435678 });
    expect(spot).toMatchObject({ lat: -33.8908, lon: 151.2744 });
  });

  it('stores the point again as GeoJSON, longitude first', async () => {
    // The order is the usual way to get this wrong, and the nearby-spots query
    // that is coming cannot tell a transposed point from a real one — it would
    // just quietly return the wrong spots.
    await createSpot(db, BONDI);

    const doc = await spots(db).findOne({});
    expect(doc?.location).toEqual({ type: 'Point', coordinates: [BONDI.lon, BONDI.lat] });
  });

  it('refuses the same spot twice, naming the one already there', async () => {
    await createSpot(db, { ...BONDI, name: 'The wall' });

    await expect(createSpot(db, BONDI)).rejects.toThrowError(/Already saved as The wall/);
    expect(await listSpots(db)).toHaveLength(1);
  });

  it('leaves nothing behind after a rejected save', async () => {
    await createSpot(db, BONDI);
    await expect(createSpot(db, BONDI)).rejects.toThrow();

    // The rejected save had already picked "Spot 2" before the insert was
    // refused. Nothing was written, so that number is still free.
    expect((await createSpot(db, MANLY)).name).toBe('Spot 2');
  });

  it.each([
    ['a missing coordinate', { lat: -33.9 }],
    ['a coordinate that is not a number', { lat: 'here', lon: 151.2 }],
    ['a latitude past the pole', { lat: 91, lon: 151.2 }],
    ['a longitude past the date line', { lat: -33.9, lon: 181 }],
  ])('rejects %s', async (_label, body) => {
    await expect(createSpot(db, body)).rejects.toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe('listSpots', () => {
  it('is empty before anything is saved', async () => {
    expect(await listSpots(db)).toEqual([]);
  });

  it('returns oldest first, with the fields the client expects', async () => {
    await createSpot(db, { ...BONDI, name: 'First' });
    await createSpot(db, { ...MANLY, name: 'Second' });

    const list = await listSpots(db);
    expect(list.map((s) => s.name)).toEqual(['First', 'Second']);
    expect(Object.keys(list[0]).sort()).toEqual(['createdAt', 'id', 'lat', 'lon', 'name']);
  });

  it('hands out an id as a string, never an ObjectId', async () => {
    // Nothing above this layer should have to know what the store's id is
    // made of, and JSON has no way to carry one anyway.
    const [spot] = [await createSpot(db, BONDI)];
    expect(typeof spot.id).toBe('string');
    expect(spot.id).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('renameSpot', () => {
  it('changes the name and hands back the whole spot', async () => {
    const { id } = await createSpot(db, BONDI);

    expect(await renameSpot(db, id, { name: 'The wall' })).toMatchObject({
      id,
      name: 'The wall',
      lat: BONDI.lat,
      lon: BONDI.lon,
    });
  });

  it.each([
    ['one that is not an id at all', 'abc'],
    ['one of the right length but not hex', 'zzzzzzzzzzzzzzzzzzzzzzzz'],
    ['a number, the way the old store numbered them', '7'],
  ])('400s on %s rather than letting the driver throw', async (_label, id) => {
    await expect(renameSpot(db, id, { name: 'x' })).rejects.toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('refuses to blank a name', async () => {
    const { id } = await createSpot(db, BONDI);
    await expect(renameSpot(db, id, { name: '  ' })).rejects.toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('404s on a spot that is not there', async () => {
    await expect(
      renameSpot(db, '65f0a1b2c3d4e5f6000000ff', { name: 'Nowhere' }),
    ).rejects.toThrowError(expect.objectContaining({ status: 404 }));
  });
});

describe('deleteSpot', () => {
  it('removes it from the list', async () => {
    const first = await createSpot(db, BONDI);
    const second = await createSpot(db, MANLY);

    await deleteSpot(db, first.id);
    expect((await listSpots(db)).map((s) => s.id)).toEqual([second.id]);
  });

  it('frees the coordinates for saving again', async () => {
    const { id } = await createSpot(db, BONDI);
    await deleteSpot(db, id);

    await expect(createSpot(db, BONDI)).resolves.toMatchObject(BONDI);
  });

  it('404s on a spot that is not there', async () => {
    await expect(deleteSpot(db, '65f0a1b2c3d4e5f6000000ff')).rejects.toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });
});
