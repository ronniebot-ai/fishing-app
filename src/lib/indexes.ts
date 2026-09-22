import type { Db } from 'mongodb';

/**
 * The collection names, defined here rather than beside their stores so this
 * module imports nothing from the project. `npm run db:indexes` runs it under
 * plain Node, which strips types but does not resolve extensionless imports
 * the way a bundler does.
 */
export const SPOTS = 'spots';
export const CONDITIONS = 'conditions';

/** How long a forecast snapshot is kept. The free tier has 512 MB to spend. */
export const SNAPSHOT_TTL_DAYS = 90;

/**
 * The indexes the store depends on.
 *
 * Kept out of the request path deliberately. `createIndexes` is idempotent, so
 * calling it on a cold start would be safe but not free, and on a serverless
 * platform "cold start" means often. It runs from `npm run db:indexes` instead,
 * and the tests call it directly so they exercise the same definitions the
 * cluster gets.
 *
 * Three of these are not optimisations. The unique index over (lat, lon) is
 * what produces the 409; the unique index over (spotId, at) is what makes
 * snapshot writes idempotent; and $geoNear refuses to run at all without a
 * 2dsphere index to read.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection(SPOTS).createIndexes([
    {
      // Turns a second save of the same point into a 409 rather than a
      // duplicate document.
      key: { lat: 1, lon: 1 },
      name: 'coords_unique',
      unique: true,
    },
    {
      // $geoNear reads this and errors without it.
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

  await db.collection(CONDITIONS).createIndexes([
    {
      // One row per spot per forecast hour. The upsert that writes snapshots
      // keys on exactly this, so re-recording the same hours is a no-op
      // instead of the way the collection grows without bound.
      key: { spotId: 1, at: 1 },
      name: 'spot_hour_unique',
      unique: true,
    },
    {
      // Every stats query starts `$match: { spotId, at: { $gte } }`. Without
      // this it is a collection scan; with it the match is an index seek and
      // the pipeline never looks at a document outside the window.
      key: { spotId: 1, at: -1 },
      name: 'spot_recent',
    },
    {
      // Snapshots age out on their own. A forecast from three months ago says
      // nothing about this weekend, and nothing here is worth 512 MB.
      key: { capturedAt: 1 },
      name: 'capturedAt_ttl',
      expireAfterSeconds: SNAPSHOT_TTL_DAYS * 24 * 60 * 60,
    },
  ]);
}
