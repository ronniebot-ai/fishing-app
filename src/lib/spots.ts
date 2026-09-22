import { ObjectId, type Collection, type Db } from 'mongodb';
import { SPOTS } from './indexes.ts';

/**
 * Everything that touches the store lives here, so the HTTP layer above it
 * stays a thin translation of status codes and the driver below it has exactly
 * one caller.
 */

/** Long enough for "Boat ramp, north side of the breakwall". */
export const NAME_MAX = 60;

/** Auto-generated names count from 1: "Spot 1", "Spot 2", ... */
const DEFAULT_NAME = /^Spot (\d+)$/;

/** A spot id on the wire: the hex form of an ObjectId. */
const ID = /^[0-9a-f]{24}$/i;

/** The wire shape. Nothing outside this file sees an ObjectId or a Date. */
export interface Spot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  createdAt: number;
}

interface SpotDoc {
  _id: ObjectId;
  name: string;
  lat: number;
  lon: number;
  /**
   * The same point again, as GeoJSON, because `$geoNear` cannot read a pair of
   * loose fields and a 2dsphere index cannot be built over them. Written from
   * the start so the nearby-spots work has nothing to backfill.
   *
   * GeoJSON is [longitude, latitude]. That order is the usual way to get this
   * wrong, which is why `toSpot` and this file are the only places it appears.
   */
  location: { type: 'Point'; coordinates: [number, number] };
  createdAt: Date;
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

export function spots(db: Db): Collection<SpotDoc> {
  return db.collection<SpotDoc>(SPOTS);
}

function toSpot(doc: SpotDoc): Spot {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    lat: doc.lat,
    lon: doc.lon,
    createdAt: doc.createdAt.getTime(),
  };
}

/**
 * The same bounds `parseSpot` enforces in the app, applied again here because
 * a server cannot trust its client.
 *
 * Coordinates are rounded to the 4 decimal places the map already hands out,
 * which is what makes the unique index on (lat, lon) mean "the same spot"
 * rather than "the same float".
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

function readId(value: unknown): ObjectId {
  if (typeof value !== 'string' || !ID.test(value)) throw new SpotError(400, 'Bad spot id.');
  return new ObjectId(value);
}

/** The write that lost a race against the unique index on (lat, lon). */
function isDuplicate(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}

/**
 * The smallest positive N with no "Spot N" already in use.
 *
 * Reusing the numbers of deleted spots is deliberate: after deleting Spot 2 of
 * three, the next save is Spot 2 again. A user who never renames anything gets
 * a short, stable set of numbers instead of a counter that climbs forever.
 */
async function nextDefaultName(db: Db): Promise<string> {
  const taken = new Set<number>();
  const cursor = spots(db).find({}, { projection: { name: 1 } });
  for await (const doc of cursor) {
    const match = DEFAULT_NAME.exec(doc.name);
    if (match) taken.add(Number(match[1]));
  }
  let n = 1;
  while (taken.has(n)) n += 1;
  return `Spot ${n}`;
}

export async function listSpots(db: Db): Promise<Spot[]> {
  const docs = await spots(db)
    .find()
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  return docs.map(toSpot);
}

/**
 * The 409 comes from the unique index rather than from a check before the
 * write, so two saves of the same point cannot both get through the gap
 * between looking and inserting.
 *
 * The SQLite version wrapped all of this in BEGIN IMMEDIATE, which took a
 * write lock over the whole database and so also serialised the name scan.
 * MongoDB has no equivalent: a transaction here would isolate reads but would
 * not stop two concurrent unnamed saves from both landing on "Spot 1", because
 * they write different documents and never conflict. It would look like a
 * guarantee without being one, so there is none. The coordinate is still
 * absolutely unique; the auto-name is best effort, and a duplicate one is
 * cosmetic and renameable.
 */
export async function createSpot(db: Db, body: unknown): Promise<Spot> {
  const { lat, lon } = readCoords(body);
  let name = readName((body as { name?: unknown } | null | undefined)?.name);
  if (!name) name = await nextDefaultName(db);

  const doc: SpotDoc = {
    _id: new ObjectId(),
    name,
    lat,
    lon,
    location: { type: 'Point', coordinates: [lon, lat] },
    createdAt: new Date(),
  };

  try {
    await spots(db).insertOne(doc);
  } catch (err) {
    if (!isDuplicate(err)) throw err;
    const clash = await spots(db).findOne({ lat, lon });
    throw new SpotError(409, `Already saved as ${clash?.name ?? 'another spot'}.`);
  }

  return toSpot(doc);
}

export async function renameSpot(db: Db, rawId: unknown, body: unknown): Promise<Spot> {
  const id = readId(rawId);
  const name = readName((body as { name?: unknown } | null | undefined)?.name);
  // Clearing a name is not how you get the default back; delete and save again.
  if (!name) throw new SpotError(400, 'name cannot be empty.');

  const doc = await spots(db).findOneAndUpdate(
    { _id: id },
    { $set: { name } },
    { returnDocument: 'after' },
  );
  if (!doc) throw new SpotError(404, 'No such spot.');

  return toSpot(doc);
}

export async function deleteSpot(db: Db, rawId: unknown): Promise<void> {
  const { deletedCount } = await spots(db).deleteOne({ _id: readId(rawId) });
  if (deletedCount === 0) throw new SpotError(404, 'No such spot.');
}
