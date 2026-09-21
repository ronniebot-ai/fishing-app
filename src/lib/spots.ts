import type { DatabaseSync } from 'node:sqlite';

/**
 * Everything that touches the store lives here, so the HTTP layer above it
 * stays a thin translation of status codes and the storage driver below it has
 * exactly one caller.
 */

/** Long enough for "Boat ramp, north side of the breakwall". */
export const NAME_MAX = 60;

/** Auto-generated names count from 1: "Spot 1", "Spot 2", ... */
const DEFAULT_NAME = /^Spot (\d+)$/;

/** The wire shape. `created_at` becomes `createdAt` in `toSpot` and nowhere else. */
export interface Spot {
  id: number;
  name: string;
  lat: number;
  lon: number;
  createdAt: number;
}

interface SpotRow {
  id: number;
  name: string;
  lat: number;
  lon: number;
  created_at: number;
}

/** An error the route layer can turn straight into a response. */
export class SpotError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SpotError';
    this.status = status;
  }
}

function toSpot(row: SpotRow): Spot {
  return { id: row.id, name: row.name, lat: row.lat, lon: row.lon, createdAt: row.created_at };
}

/**
 * The same bounds `parseSpot` enforces in the app, applied again here because
 * a server cannot trust its client.
 *
 * Coordinates are rounded to the 4 decimal places the map already hands out,
 * which is what makes UNIQUE (lat, lon) mean "the same spot" rather than "the
 * same float".
 */
function readCoords(body: unknown): { lat: number; lon: number } {
  const source = body as { lat?: unknown; lon?: unknown } | null | undefined;
  const lat = Number(source?.lat);
  const lon = Number(source?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new SpotError(400, 'lat and lon must be numbers.');
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new SpotError(400, 'lat and lon are out of range.');
  }
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

/** Returns '' for a missing or blank name — the caller decides what that means. */
function readName(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new SpotError(400, 'name must be a string.');
  return value.trim().slice(0, NAME_MAX);
}

function readId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new SpotError(400, 'Bad spot id.');
  return id;
}

/**
 * The smallest positive N with no "Spot N" already in use.
 *
 * Reusing the numbers of deleted spots is deliberate: after deleting Spot 2 of
 * three, the next save is Spot 2 again. A user who never renames anything gets
 * a short, stable set of numbers instead of a counter that climbs forever.
 */
function nextDefaultName(db: DatabaseSync): string {
  const taken = new Set<number>();
  for (const row of db.prepare('SELECT name FROM spots').all() as unknown as { name: string }[]) {
    const match = DEFAULT_NAME.exec(row.name);
    if (match) taken.add(Number(match[1]));
  }
  let n = 1;
  while (taken.has(n)) n += 1;
  return `Spot ${n}`;
}

export function listSpots(db: DatabaseSync): Spot[] {
  return (
    db.prepare('SELECT * FROM spots ORDER BY created_at, id').all() as unknown as SpotRow[]
  ).map(toSpot);
}

export function createSpot(db: DatabaseSync, body: unknown): Spot {
  const { lat, lon } = readCoords(body);
  let name = readName((body as { name?: unknown } | null | undefined)?.name);

  // One transaction, because the name is picked from the same rows the insert
  // lands among: two saves in flight at once must not both become "Spot 1".
  db.exec('BEGIN IMMEDIATE');
  try {
    const clash = db.prepare('SELECT * FROM spots WHERE lat = ? AND lon = ?').get(lat, lon) as
      | SpotRow
      | undefined;
    if (clash) throw new SpotError(409, `Already saved as ${clash.name}.`);

    if (!name) name = nextDefaultName(db);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO spots (name, lat, lon, created_at) VALUES (?, ?, ?, ?)')
      .run(name, lat, lon, Date.now());

    const row = db
      .prepare('SELECT * FROM spots WHERE id = ?')
      .get(Number(lastInsertRowid)) as unknown as SpotRow;
    db.exec('COMMIT');
    return toSpot(row);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function renameSpot(db: DatabaseSync, rawId: unknown, body: unknown): Spot {
  const id = readId(rawId);
  const name = readName((body as { name?: unknown } | null | undefined)?.name);
  // Clearing a name is not how you get the default back; delete and save again.
  if (!name) throw new SpotError(400, 'name cannot be empty.');

  const { changes } = db.prepare('UPDATE spots SET name = ? WHERE id = ?').run(name, id);
  if (Number(changes) === 0) throw new SpotError(404, 'No such spot.');

  return toSpot(db.prepare('SELECT * FROM spots WHERE id = ?').get(id) as unknown as SpotRow);
}

export function deleteSpot(db: DatabaseSync, rawId: unknown): void {
  const id = readId(rawId);
  const { changes } = db.prepare('DELETE FROM spots WHERE id = ?').run(id);
  if (Number(changes) === 0) throw new SpotError(404, 'No such spot.');
}
