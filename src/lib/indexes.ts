import type { Db } from 'mongodb';

/**
 * The collection name, defined here rather than in spots.ts so this module
 * imports nothing from the project. `npm run db:indexes` runs it under plain
 * Node, which strips types but does not resolve extensionless imports the way
 * a bundler does.
 */
export const SPOTS = 'spots';

/**
 * The indexes the store depends on.
 *
 * Kept out of the request path deliberately. `createIndexes` is idempotent, so
 * calling it on a cold start would be safe but not free, and on a serverless
 * platform "cold start" means often. It runs from `npm run db:indexes` instead,
 * and the tests call it directly so they exercise the same definitions the
 * cluster gets.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection(SPOTS).createIndexes([
    {
      // The one the store's behaviour actually rests on: it is what turns a
      // second save of the same point into a 409 rather than a duplicate row.
      key: { lat: 1, lon: 1 },
      name: 'coords_unique',
      unique: true,
    },
    {
      // Unused until the nearby-spots query lands, but built now so that work
      // has no migration in front of it. $geoNear refuses to run without it.
      key: { location: '2dsphere' },
      name: 'location_2dsphere',
    },
    {
      // `nextDefaultName` reads every name to find the lowest free number.
      // Covered by this, so it never touches a document.
      key: { name: 1 },
      name: 'name',
    },
  ]);
}
