/**
 * The store's rules. The one worth reading twice is the naming: an unnamed
 * spot is given the lowest free number, not the next one, so deleting from the
 * middle of the list reuses that number rather than leaving a hole.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from './db';
import { createSpot, deleteSpot, listSpots, renameSpot } from './spots';

const BONDI = { lat: -33.8908, lon: 151.2743 };
const MANLY = { lat: -33.7969, lon: 151.2873 };

let db: DatabaseSync;

beforeEach(() => {
  db = openDb(':memory:');
});

describe('createSpot', () => {
  it('numbers unnamed spots from 1, in the order they were saved', () => {
    expect(createSpot(db, BONDI).name).toBe('Spot 1');
    expect(createSpot(db, MANLY).name).toBe('Spot 2');
  });

  it('keeps a name the user typed', () => {
    expect(createSpot(db, { ...BONDI, name: 'South end, off the rocks' }).name)
      .toBe('South end, off the rocks');
  });

  it('treats a blank name as no name', () => {
    expect(createSpot(db, { ...BONDI, name: '   ' }).name).toBe('Spot 1');
  });

  it('trims a name rather than storing the whitespace', () => {
    expect(createSpot(db, { ...BONDI, name: '  The wall  ' }).name).toBe('The wall');
  });

  it('fills the gap left by a delete instead of climbing', () => {
    const first = createSpot(db, BONDI);
    createSpot(db, MANLY);
    deleteSpot(db, first.id);

    expect(createSpot(db, { lat: -32.0, lon: 152.0 }).name).toBe('Spot 1');
  });

  it('counts the numbers in use, not the rows', () => {
    createSpot(db, BONDI); // Spot 1
    renameSpot(db, 1, { name: 'Spot 2' });

    // "Spot 2" is taken now, whoever took it, and "Spot 1" is free again.
    expect(createSpot(db, MANLY).name).toBe('Spot 1');
  });

  it('rounds coordinates to the 4dp the map hands out', () => {
    const spot = createSpot(db, { lat: -33.89081234, lon: 151.27435678 });
    expect(spot).toMatchObject({ lat: -33.8908, lon: 151.2744 });
  });

  it('refuses the same spot twice, naming the one already there', () => {
    createSpot(db, { ...BONDI, name: 'The wall' });

    expect(() => createSpot(db, BONDI)).toThrowError(/Already saved as The wall/);
    expect(listSpots(db)).toHaveLength(1);
  });

  it('leaves no half-written row behind after a rejected save', () => {
    createSpot(db, BONDI);
    expect(() => createSpot(db, BONDI)).toThrow();

    // The insert ran inside a transaction; the rollback has to have landed or
    // the next save would be working against a locked database.
    expect(createSpot(db, MANLY).name).toBe('Spot 2');
  });

  it.each([
    ['a missing coordinate', { lat: -33.9 }],
    ['a coordinate that is not a number', { lat: 'here', lon: 151.2 }],
    ['a latitude past the pole', { lat: 91, lon: 151.2 }],
    ['a longitude past the date line', { lat: -33.9, lon: 181 }],
  ])('rejects %s', (_label, body) => {
    expect(() => createSpot(db, body)).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe('listSpots', () => {
  it('is empty before anything is saved', () => {
    expect(listSpots(db)).toEqual([]);
  });

  it('returns oldest first, with the fields the client expects', () => {
    createSpot(db, { ...BONDI, name: 'First' });
    createSpot(db, { ...MANLY, name: 'Second' });

    const list = listSpots(db);
    expect(list.map((s) => s.name)).toEqual(['First', 'Second']);
    expect(Object.keys(list[0]).sort()).toEqual(['createdAt', 'id', 'lat', 'lon', 'name']);
  });
});

describe('renameSpot', () => {
  it('changes the name and hands back the whole spot', () => {
    const { id } = createSpot(db, BONDI);

    expect(renameSpot(db, id, { name: 'The wall' })).toMatchObject({
      id, name: 'The wall', lat: BONDI.lat, lon: BONDI.lon,
    });
  });

  it('accepts the id as a string, the way a URL supplies it', () => {
    const { id } = createSpot(db, BONDI);
    expect(renameSpot(db, String(id), { name: 'The wall' }).name).toBe('The wall');
  });

  it('refuses to blank a name', () => {
    const { id } = createSpot(db, BONDI);
    expect(() => renameSpot(db, id, { name: '  ' })).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('404s on a spot that is not there', () => {
    expect(() => renameSpot(db, 99, { name: 'Nowhere' })).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });
});

describe('deleteSpot', () => {
  it('removes it from the list', () => {
    const { id } = createSpot(db, BONDI);
    createSpot(db, MANLY);

    deleteSpot(db, id);
    expect(listSpots(db).map((s) => s.id)).toEqual([2]);
  });

  it('frees the coordinates for saving again', () => {
    const { id } = createSpot(db, BONDI);
    deleteSpot(db, id);

    expect(() => createSpot(db, BONDI)).not.toThrow();
  });

  it('404s on a spot that is not there', () => {
    expect(() => deleteSpot(db, 99)).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });
});
