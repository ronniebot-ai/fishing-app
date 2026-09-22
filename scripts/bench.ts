/**
 * Measure what the indexes and the facet are worth.
 *
 *   npm run db:bench              50k snapshots over 40 spots
 *   npm run db:bench -- 200000    more, if you want to see it diverge
 *
 * Everything happens in a scratch database (`<db>-bench`) which is dropped on
 * the way out, so this is safe to point at the same cluster as the app.
 *
 * The comparisons are honest ones. `hint: { $natural: 1 }` forces a collection
 * scan without dropping anything, so the two sides of the index comparison run
 * against the same documents in the same process a moment apart.
 */
import { ObjectId } from 'mongodb';
import { CONDITIONS, ensureIndexes, SPOTS } from '../src/lib/indexes.ts';
import { getDb } from '../src/lib/mongo.ts';

const TARGET = Number(process.argv[2] ?? 50_000);
const SPOT_COUNT = 40;
const DAYS = 60;

const base = await getDb();
const db = base.client.db(`${base.databaseName}-bench`);

async function seed(): Promise<ObjectId[]> {
  await db.dropDatabase();
  await ensureIndexes(db);

  const ids: ObjectId[] = [];
  const spots = Array.from({ length: SPOT_COUNT }, (_, i) => {
    const _id = new ObjectId();
    ids.push(_id);
    // Strung along the coast, a few km apart, so $geoNear has a real ordering
    // to produce rather than a pile of ties.
    const lat = Math.round((-33.9 + i * 0.03) * 1e4) / 1e4;
    const lon = Math.round((151.27 + i * 0.01) * 1e4) / 1e4;
    return {
      _id,
      name: `Spot ${i + 1}`,
      lat,
      lon,
      location: { type: 'Point', coordinates: [lon, lat] },
      createdAt: new Date(),
    };
  });
  await db.collection(SPOTS).insertMany(spots);

  const perSpot = Math.ceil(TARGET / SPOT_COUNT);
  const now = Date.now();
  let written = 0;

  for (const _id of ids) {
    const batch = Array.from({ length: perSpot }, (_v, h) => {
      const at = new Date(now - (h % (DAYS * 24)) * 3600_000 - Math.floor(h / (DAYS * 24)) * 60_000);
      return {
        _id: new ObjectId(),
        spotId: _id,
        at,
        capturedAt: new Date(),
        tz: '+10:00',
        score: Math.round(Math.abs(Math.sin(h)) * 100),
        unfishable: h % 17 === 0,
        factors: { tide: 0.5, wind: 0.6, wave: 0.7, rain: 0.9 },
        windKn: 10 + (h % 20),
        gustKn: 15 + (h % 25),
        waveM: 0.5 + (h % 5) / 10,
        tideRate: 0.2,
        rainMm: 0,
      };
    });
    // The unique index over (spotId, at) means a repeated hour is refused
    // rather than duplicated, which at this size is a handful of collisions.
    try {
      const { insertedCount } = await db.collection(CONDITIONS).insertMany(batch, { ordered: false });
      written += insertedCount;
    } catch (err) {
      written += (err as { result?: { insertedCount?: number } }).result?.insertedCount ?? 0;
    }
  }

  return ids;
}

/** executionStats sits at a different depth depending on the pipeline. */
function stats(explain: unknown): { examined: number; returned: number; ms: number } {
  let found: Record<string, number> | null = null;
  const walk = (node: unknown) => {
    if (found || node === null || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if ('totalDocsExamined' in obj && 'nReturned' in obj) {
      found = obj as Record<string, number>;
      return;
    }
    for (const value of Object.values(obj)) walk(value);
  };
  walk(explain);
  const s = (found ?? {}) as Record<string, number>;
  return {
    examined: s.totalDocsExamined ?? -1,
    returned: s.nReturned ?? -1,
    ms: s.executionTimeMillis ?? -1,
  };
}

async function timed<T>(run: () => Promise<T>, times = 5): Promise<number> {
  await run(); // warm
  const started = performance.now();
  for (let i = 0; i < times; i += 1) await run();
  return (performance.now() - started) / times;
}

const spotIds = await seed();
const total = await db.collection(CONDITIONS).countDocuments();
const spotId = spotIds[0];
const since = new Date(Date.now() - 30 * 24 * 3600_000);

console.log(`\n${db.databaseName}: ${total.toLocaleString()} snapshots across ${SPOT_COUNT} spots\n`);

// ---------------------------------------------------------------- the match
// Averaging a field rather than counting, so the documents actually have to be
// fetched. A `$count` here would be answered from the index alone and would
// flatter the result into meaninglessness.
const match = [
  { $match: { spotId, at: { $gte: since } } },
  { $group: { _id: null, avg: { $avg: '$score' } } },
];

const withIndex = stats(
  await db.collection(CONDITIONS).aggregate(match).explain('executionStats'),
);
const withoutIndex = stats(
  await db
    .collection(CONDITIONS)
    .aggregate(match, { hint: { $natural: 1 } })
    .explain('executionStats'),
);

console.log('stats $match on (spotId, at)');
console.log(`  index seek       examined ${String(withIndex.examined).padStart(8)}   ${withIndex.ms} ms`);
console.log(`  collection scan  examined ${String(withoutIndex.examined).padStart(8)}   ${withoutIndex.ms} ms`);
console.log(
  withIndex.examined === 0
    ? '  -> covered by the index: not one document was fetched\n'
    : `  -> ${(withoutIndex.examined / withIndex.examined).toFixed(0)}x fewer documents read\n`,
);

// ---------------------------------------------------------------- the facet
const byHour = [
  { $group: { _id: { $hour: { date: '$at', timezone: '$tz' } }, avgScore: { $avg: '$score' }, samples: { $sum: 1 } } },
  { $sort: { _id: 1 } },
];
const distribution = [
  { $bucket: { groupBy: '$score', boundaries: [0, 20, 40, 60, 80, 101], default: 'other', output: { samples: { $sum: 1 } } } },
];
const factors = [
  { $group: { _id: null, tide: { $avg: '$factors.tide' }, wind: { $avg: '$factors.wind' }, wave: { $avg: '$factors.wave' }, rain: { $avg: '$factors.rain' } } },
];
const totals = [{ $group: { _id: null, samples: { $sum: 1 }, unfishable: { $sum: { $cond: ['$unfishable', 1, 0] } } } }];
const head = { $match: { spotId, at: { $gte: since } } };

const faceted = await timed(() =>
  db
    .collection(CONDITIONS)
    .aggregate([head, { $facet: { byHour, distribution, factors, totals } }])
    .toArray(),
);

const separate = await timed(async () => {
  for (const tail of [byHour, distribution, factors, totals]) {
    await db.collection(CONDITIONS).aggregate([head, ...tail]).toArray();
  }
});

console.log('the four stats questions');
console.log(`  one $facet       ${faceted.toFixed(1)} ms`);
console.log(`  four pipelines   ${separate.toFixed(1)} ms`);
console.log(`  -> ${(separate / faceted).toFixed(1)}x, and one round trip instead of four\n`);

// ---------------------------------------------------------------- $geoNear
const near = [
  {
    $geoNear: {
      near: { type: 'Point', coordinates: [151.27, -33.9] },
      distanceField: 'distanceM',
      maxDistance: 50_000,
      spherical: true,
      key: 'location',
    },
  },
  { $limit: 20 },
];

const geo = stats(await db.collection(SPOTS).aggregate(near).explain('executionStats'));
console.log('nearby spots');
console.log(`  $geoNear over 2dsphere   examined ${geo.examined}   ${geo.ms} ms`);

await db.collection(SPOTS).dropIndex('location_2dsphere');
try {
  await db.collection(SPOTS).aggregate(near).toArray();
  console.log('  without the index        ran anyway  <-- unexpected');
} catch (err) {
  // Worth stating plainly: this is not a slow path, it is not a path.
  console.log(`  without the index        refuses to run: ${(err as Error).message.slice(0, 60)}...`);
}

await db.dropDatabase();
console.log('\nscratch database dropped.');
process.exit(0);
