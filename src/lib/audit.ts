import { ObjectId, type Db } from 'mongodb';
import { CONDITIONS, SPOTS } from './indexes.ts';

/**
 * What can go wrong in the store, and how to put it right.
 *
 * Every check is an aggregation. That is not showing off: the questions are
 * about relationships between documents ("is there a spot for this snapshot",
 * "are these two the same place"), and pulling the collection into Node to ask
 * them would stop working at exactly the size where you would want to ask.
 *
 * This module imports nothing from the project but `indexes.ts`, and imports
 * that with an explicit extension, because `npm run db:audit` loads it under
 * plain Node. Node strips types but does not resolve extensionless imports the
 * way a bundler does.
 */

/** Coordinates are stored to 4dp, about 11 m. Rounding to 3 buckets ~110 m. */
const NEAR_DP = 3;

export interface Finding {
  check: string;
  /** What was found, phrased for someone deciding whether to act on it. */
  description: string;
  count: number;
  /** Whether `--fix` will do anything about it. */
  fixable: boolean;
  /** A few examples, for the report. Never the whole set. */
  examples: unknown[];
}

interface Cluster {
  _id: { lat: number; lon: number };
  n: number;
  members: { id: ObjectId; name: string; createdAt: Date }[];
}

/**
 * Spots close enough together to be the same place saved twice.
 *
 * The unique index rules out two documents at the same coordinates, so this is
 * looking for the case it cannot see: two taps a few metres apart, which round
 * to different 4dp pairs and so are two spots as far as the index is concerned.
 *
 * One `$group` over a coarser rounding does the whole thing in a single pass.
 * The alternative — `$geoNear` outward from every spot — is a true radius but
 * costs one aggregation per document, and a cell is close enough to hand a
 * person something to look at.
 */
async function nearDuplicates(db: Db): Promise<Cluster[]> {
  return db
    .collection(SPOTS)
    .aggregate<Cluster>([
      {
        $group: {
          _id: { lat: { $round: ['$lat', NEAR_DP] }, lon: { $round: ['$lon', NEAR_DP] } },
          n: { $sum: 1 },
          members: { $push: { id: '$_id', name: '$name', createdAt: '$createdAt' } },
        },
      },
      { $match: { n: { $gt: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();
}

/** Snapshots whose spot is gone. Only a delete racing a write can make these. */
async function orphanSnapshots(db: Db) {
  return db
    .collection(CONDITIONS)
    .aggregate<{ _id: ObjectId; n: number }>([
      {
        $lookup: { from: SPOTS, localField: 'spotId', foreignField: '_id', as: 'spot' },
      },
      { $match: { spot: { $size: 0 } } },
      { $group: { _id: '$spotId', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();
}

/** Spots that are not on the planet. The API rejects these; history might not. */
async function offPlanet(db: Db) {
  return db
    .collection(SPOTS)
    .find({
      $or: [{ lat: { $gt: 90 } }, { lat: { $lt: -90 } }, { lon: { $gt: 180 } }, { lon: { $lt: -180 } }],
    })
    .project({ name: 1, lat: 1, lon: 1 })
    .limit(50)
    .toArray();
}

/**
 * Spots whose GeoJSON point disagrees with their lat/lon, or is missing.
 *
 * Worth checking precisely because nothing would notice: `$geoNear` reads
 * `location` and every other query reads `lat`/`lon`, so a spot can be in the
 * right place on the map and the wrong place in the nearby list indefinitely.
 *
 * Spots that are not on the planet are left out. They are reported by the
 * check above, and there is nothing to rebuild a point from: a 2dsphere index
 * rejects a coordinate out of bounds, so writing one would fail rather than
 * repair anything. Which is also why a document like that can only exist with
 * no `location` at all.
 */
async function locationOutOfStep(db: Db) {
  return db
    .collection(SPOTS)
    .aggregate<{ _id: ObjectId; name: string; lat: number; lon: number }>([
      {
        $match: {
          lat: { $gte: -90, $lte: 90 },
          lon: { $gte: -180, $lte: 180 },
          $expr: {
            $or: [
              { $eq: [{ $type: '$location' }, 'missing'] },
              { $ne: [{ $arrayElemAt: ['$location.coordinates', 0] }, '$lon'] },
              { $ne: [{ $arrayElemAt: ['$location.coordinates', 1] }, '$lat'] },
            ],
          },
        },
      },
      { $project: { name: 1, lat: 1, lon: 1, location: 1 } },
      { $limit: 50 },
    ])
    .toArray();
}

/** Spots stored at more precision than the map can produce. */
async function precisionDrift(db: Db) {
  return db
    .collection(SPOTS)
    .aggregate<{ _id: ObjectId; name: string; lat: number; lon: number }>([
      {
        $match: {
          $expr: {
            $or: [
              { $ne: ['$lat', { $round: ['$lat', 4] }] },
              { $ne: ['$lon', { $round: ['$lon', 4] }] },
            ],
          },
        },
      },
      { $project: { name: 1, lat: 1, lon: 1 } },
      { $limit: 50 },
    ])
    .toArray();
}

export async function audit(db: Db): Promise<Finding[]> {
  const [clusters, orphans, wild, crooked, drifted] = await Promise.all([
    nearDuplicates(db),
    orphanSnapshots(db),
    offPlanet(db),
    locationOutOfStep(db),
    precisionDrift(db),
  ]);

  return [
    {
      check: 'near-duplicate spots',
      description: `spots within about ${10 ** (4 - NEAR_DP) * 11} m of another`,
      count: clusters.reduce((sum, c) => sum + c.n - 1, 0),
      fixable: true,
      examples: clusters.slice(0, 5).map((c) => ({
        at: c._id,
        keeping: c.members.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b)).name,
        names: c.members.map((m) => m.name),
      })),
    },
    {
      check: 'orphan snapshots',
      description: 'forecast hours whose spot has been deleted',
      count: orphans.reduce((sum, o) => sum + o.n, 0),
      fixable: true,
      examples: orphans.slice(0, 5).map((o) => ({ spotId: o._id.toHexString(), hours: o.n })),
    },
    {
      check: 'coordinates off the planet',
      description: 'latitude past a pole or longitude past the date line',
      count: wild.length,
      fixable: false,
      examples: wild.slice(0, 5),
    },
    {
      check: 'location out of step',
      description: 'GeoJSON point missing, or disagreeing with lat/lon',
      count: crooked.length,
      fixable: true,
      examples: crooked.slice(0, 5),
    },
    {
      check: 'precision drift',
      description: 'coordinates stored finer than the 4dp the map hands out',
      count: drifted.length,
      fixable: true,
      examples: drifted.slice(0, 5),
    },
  ];
}

export interface FixResult {
  check: string;
  action: string;
  count: number;
}

/**
 * Merge a cluster of near-duplicates into its oldest member.
 *
 * The snapshots have to move before the losing spots are deleted, and moving
 * them is the part with a trap in it: (spotId, at) is unique, so an hour the
 * keeper already holds cannot simply be repointed. Those are dropped first —
 * the keeper's copy is the one to believe, since it is the spot that survives.
 */
async function mergeCluster(db: Db, cluster: Cluster): Promise<number> {
  const ordered = [...cluster.members].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const keeper = ordered[0].id;
  const losers = ordered.slice(1).map((m) => m.id);

  const held = await db
    .collection(CONDITIONS)
    .distinct('at', { spotId: keeper });

  await db.collection(CONDITIONS).deleteMany({ spotId: { $in: losers }, at: { $in: held } });
  await db
    .collection(CONDITIONS)
    .updateMany({ spotId: { $in: losers } }, { $set: { spotId: keeper } });
  await db.collection(SPOTS).deleteMany({ _id: { $in: losers } });

  return losers.length;
}

export async function applyFixes(db: Db): Promise<FixResult[]> {
  const results: FixResult[] = [];

  // Order matters. Rounding coordinates can push two spots onto the same 4dp
  // pair, so precision is fixed first and the merge pass then sees the
  // duplicates it creates.
  const drifted = await precisionDrift(db);
  let rounded = 0;
  let collided = 0;
  for (const spot of drifted) {
    const lat = Math.round(spot.lat * 1e4) / 1e4;
    const lon = Math.round(spot.lon * 1e4) / 1e4;
    try {
      await db.collection(SPOTS).updateOne(
        { _id: spot._id },
        { $set: { lat, lon, location: { type: 'Point', coordinates: [lon, lat] } } },
      );
      rounded += 1;
    } catch (err) {
      // Rounding landed it on a spot that already exists. Leave it for the
      // merge pass rather than deciding here which one is real.
      if ((err as { code?: number }).code !== 11000) throw err;
      collided += 1;
    }
  }
  if (rounded > 0) results.push({ check: 'precision drift', action: 'rounded to 4dp', count: rounded });
  if (collided > 0) {
    results.push({ check: 'precision drift', action: 'left for the merge pass', count: collided });
  }

  const crooked = await locationOutOfStep(db);
  for (const spot of crooked) {
    await db.collection(SPOTS).updateOne(
      { _id: spot._id },
      { $set: { location: { type: 'Point', coordinates: [spot.lon, spot.lat] } } },
    );
  }
  if (crooked.length > 0) {
    results.push({ check: 'location out of step', action: 'rebuilt from lat/lon', count: crooked.length });
  }

  const clusters = await nearDuplicates(db);
  let merged = 0;
  for (const cluster of clusters) merged += await mergeCluster(db, cluster);
  if (merged > 0) {
    results.push({ check: 'near-duplicate spots', action: 'merged into the oldest', count: merged });
  }

  // Last, because merging deletes spots and so can make new orphans.
  const orphans = await orphanSnapshots(db);
  if (orphans.length > 0) {
    const { deletedCount } = await db
      .collection(CONDITIONS)
      .deleteMany({ spotId: { $in: orphans.map((o) => o._id) } });
    results.push({ check: 'orphan snapshots', action: 'deleted', count: deletedCount });
  }

  return results;
}
