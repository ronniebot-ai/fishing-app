import { ObjectId, type Collection, type Db } from 'mongodb';
import { CONDITIONS } from './indexes.ts';
import { SpotError, spots } from './spots.ts';

/**
 * Forecast snapshots, and the aggregations that read them.
 *
 * The app already computes a score for every hour it draws. Keeping those
 * hours turns a screen that only knows about right now into something that can
 * answer "when is this spot usually worth it" — which is a question about the
 * spot rather than about the weather, and so is the one thing here that no
 * forecast API can answer for us.
 */

/** A snapshot carries at most this many hours. The app draws 48. */
const MAX_HOURS = 200;

/** How far back the stats read by default. */
export const STATS_DAYS = 30;

/** Score bands, low to high. The last boundary is exclusive, hence 101. */
const SCORE_BANDS = [0, 20, 40, 60, 80, 101];

export interface ConditionDoc {
  _id: ObjectId;
  spotId: ObjectId;
  /** The forecast hour, as an instant. */
  at: Date;
  /** When this reading was recorded, which is what the TTL index ages out. */
  capturedAt: Date;
  /**
   * The spot's UTC offset as `+HH:MM`, stored per document so the hour-of-day
   * grouping can be done in the spot's own time rather than in one hard-coded
   * zone. `$hour` takes its `timezone` as an expression, so the pipeline reads
   * it straight off the document.
   */
  tz: string;
  score: number;
  unfishable: boolean;
  /** Each 0-1, the normalised factors behind the score. */
  factors: {
    tide: number | null;
    wind: number | null;
    wave: number | null;
    weather: number | null;
    windDir: number | null;
  };
  windKn: number | null;
  gustKn: number | null;
  waveM: number | null;
  swellM: number | null;
  tideRate: number | null;
  rainMm: number | null;
  cloudPct: number | null;
}

export function conditions(db: Db): Collection<ConditionDoc> {
  return db.collection<ConditionDoc>(CONDITIONS);
}

/** Seconds east of UTC as the `+HH:MM` string `$hour` accepts as a timezone. */
export function offsetToTz(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  const total = Math.abs(Math.trunc(seconds));
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

function readUnit(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new SpotError(400, `${field} must be between 0 and 1.`);
  }
  return n;
}

function readOptional(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new SpotError(400, `${field} must be a number.`);
  return n;
}

/**
 * One hour, as the app sends it.
 *
 * The scores are recomputed by the client from the same domain functions that
 * drew the screen rather than being derived again here, which is what keeps a
 * stored score and a displayed score from ever disagreeing.
 */
function readHour(raw: unknown, tz: string, capturedAt: Date, spotId: ObjectId) {
  const hour = raw as Record<string, unknown> | null;
  const at = new Date(String(hour?.at));
  if (Number.isNaN(at.getTime())) throw new SpotError(400, 'Each hour needs a valid `at`.');

  const score = Number(hour?.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new SpotError(400, 'score must be between 0 and 100.');
  }

  const factors = (hour?.factors ?? {}) as Record<string, unknown>;

  return {
    spotId,
    at,
    capturedAt,
    tz,
    score,
    unfishable: hour?.unfishable === true,
    factors: {
      tide: readUnit(factors.tide, 'factors.tide'),
      wind: readUnit(factors.wind, 'factors.wind'),
      wave: readUnit(factors.wave, 'factors.wave'),
      weather: readUnit(factors.weather, 'factors.weather'),
      windDir: readUnit(factors.windDir, 'factors.windDir'),
    },
    windKn: readOptional(hour?.windKn, 'windKn'),
    gustKn: readOptional(hour?.gustKn, 'gustKn'),
    waveM: readOptional(hour?.waveM, 'waveM'),
    swellM: readOptional(hour?.swellM, 'swellM'),
    tideRate: readOptional(hour?.tideRate, 'tideRate'),
    rainMm: readOptional(hour?.rainMm, 'rainMm'),
    cloudPct: readOptional(hour?.cloudPct, 'cloudPct'),
  };
}

export interface RecordResult {
  received: number;
  inserted: number;
  updated: number;
}

/**
 * Record a batch of forecast hours for one spot.
 *
 * Every hour is an upsert keyed on (spotId, at), which the unique index backs.
 * That is the whole deduplication story on the write side: the app re-sends
 * overlapping windows every time somebody opens a spot, and re-sending an hour
 * already held updates it in place rather than adding a second copy. Nothing
 * downstream has to filter duplicates because none are ever created.
 *
 * One round trip, not one per hour.
 */
export async function recordSnapshots(
  db: Db,
  rawSpotId: unknown,
  body: unknown,
): Promise<RecordResult> {
  if (typeof rawSpotId !== 'string' || !/^[0-9a-f]{24}$/i.test(rawSpotId)) {
    throw new SpotError(400, 'Bad spot id.');
  }
  const spotId = new ObjectId(rawSpotId);

  const payload = (body ?? {}) as { hours?: unknown; utcOffsetSeconds?: unknown };
  const hours = payload.hours;
  if (!Array.isArray(hours)) throw new SpotError(400, '`hours` must be an array.');
  if (hours.length === 0) return { received: 0, inserted: 0, updated: 0 };
  if (hours.length > MAX_HOURS) {
    throw new SpotError(400, `No more than ${MAX_HOURS} hours at a time.`);
  }

  const offset = Number(payload.utcOffsetSeconds ?? 0);
  if (!Number.isFinite(offset) || Math.abs(offset) > 15 * 3600) {
    throw new SpotError(400, 'utcOffsetSeconds is out of range.');
  }

  // Refuse to write snapshots for a spot that is not there, so the only way to
  // end up with orphans is a delete racing a write — which is what the audit
  // looks for.
  const spot = await spots(db).findOne({ _id: spotId }, { projection: { _id: 1 } });
  if (!spot) throw new SpotError(404, 'No such spot.');

  const tz = offsetToTz(offset);
  const capturedAt = new Date();
  const docs = hours.map((hour) => readHour(hour, tz, capturedAt, spotId));

  const result = await conditions(db).bulkWrite(
    docs.map((doc) => ({
      updateOne: {
        filter: { spotId: doc.spotId, at: doc.at },
        update: { $set: doc, $setOnInsert: { _id: new ObjectId() } },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return {
    received: docs.length,
    inserted: result.upsertedCount,
    updated: result.modifiedCount,
  };
}

export interface HourStat {
  hour: number;
  avgScore: number;
  bestScore: number;
  samples: number;
}

export interface SpotStats {
  /** How many snapshots the numbers below are drawn from. */
  samples: number;
  days: number;
  /** Average and best score for each hour of the day, in the spot's own time. */
  byHour: HourStat[];
  /** How the scores fall across the bands the UI colours by. */
  distribution: { from: number; to: number; samples: number }[];
  /** Mean contribution of each factor, 0-1. Null when there is nothing to average. */
  factors: { tide: number; wind: number; wave: number; weather: number; windDir: number } | null;
  /** Share of hours the gates called unfishable, 0-1. */
  unfishableShare: number;
}

/**
 * Everything the stats panel shows, in one round trip.
 *
 * `$facet` is the point of this pipeline. The four questions below read the
 * same matched set of documents and would otherwise be four queries; inside a
 * facet they are four sub-pipelines over one pass, so the cost of the `$match`
 * is paid once rather than four times.
 *
 * The `$match` is first and is an index seek on (spotId, at), so nothing
 * outside the window is ever examined — see the numbers in the README.
 */
export async function spotStats(db: Db, rawSpotId: unknown, days = STATS_DAYS): Promise<SpotStats> {
  if (typeof rawSpotId !== 'string' || !/^[0-9a-f]{24}$/i.test(rawSpotId)) {
    throw new SpotError(400, 'Bad spot id.');
  }
  const window = Number(days);
  if (!Number.isInteger(window) || window < 1 || window > 365) {
    throw new SpotError(400, 'days must be a whole number between 1 and 365.');
  }

  const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);

  const [result] = await conditions(db)
    .aggregate<{
      byHour: HourStat[];
      distribution: { _id: number | string; samples: number }[];
      factors: { tide: number; wind: number; wave: number; weather: number; windDir: number }[];
      totals: { samples: number; unfishable: number }[];
    }>([
      { $match: { spotId: new ObjectId(rawSpotId), at: { $gte: since } } },
      {
        $facet: {
          byHour: [
            {
              $group: {
                // The spot's own clock, not ours: `timezone` takes an
                // expression, so each document supplies its own offset.
                _id: { $hour: { date: '$at', timezone: '$tz' } },
                avgScore: { $avg: '$score' },
                bestScore: { $max: '$score' },
                samples: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
            {
              $project: {
                _id: 0,
                hour: '$_id',
                avgScore: { $round: ['$avgScore', 1] },
                bestScore: 1,
                samples: 1,
              },
            },
          ],
          distribution: [
            {
              $bucket: {
                groupBy: '$score',
                boundaries: SCORE_BANDS,
                default: 'other',
                output: { samples: { $sum: 1 } },
              },
            },
          ],
          factors: [
            {
              $group: {
                _id: null,
                tide: { $avg: '$factors.tide' },
                wind: { $avg: '$factors.wind' },
                wave: { $avg: '$factors.wave' },
                weather: { $avg: '$factors.weather' },
                windDir: { $avg: '$factors.windDir' },
              },
            },
            { $project: { _id: 0 } },
          ],
          totals: [
            {
              $group: {
                _id: null,
                samples: { $sum: 1 },
                unfishable: { $sum: { $cond: ['$unfishable', 1, 0] } },
              },
            },
            { $project: { _id: 0 } },
          ],
        },
      },
    ])
    .toArray();

  const totals = result?.totals[0] ?? { samples: 0, unfishable: 0 };

  return {
    samples: totals.samples,
    days: window,
    byHour: result?.byHour ?? [],
    // `$bucket` labels each band with its lower boundary; pair it back up with
    // the upper one so the client does not have to know the boundaries.
    distribution: (result?.distribution ?? [])
      .filter((band): band is { _id: number; samples: number } => typeof band._id === 'number')
      .map((band) => ({
        from: band._id,
        to: SCORE_BANDS[SCORE_BANDS.indexOf(band._id) + 1] - 1,
        samples: band.samples,
      })),
    factors: result?.factors[0] ?? null,
    unfishableShare: totals.samples === 0 ? 0 : totals.unfishable / totals.samples,
  };
}

function blank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

export interface NearbySpot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Great-circle distance from the point asked about, in metres. */
  distanceM: number;
  /** The next forecast hour held for it, if any. */
  nextAt: string | null;
  nextScore: number | null;
}

/**
 * Saved spots within `km` of a point, nearest first.
 *
 * `$geoNear` has to be the first stage of the pipeline and reads the 2dsphere
 * index directly — without that index it does not fall back to a scan, it
 * refuses to run. It also does the sorting, so there is no `$sort` here.
 *
 * The `$lookup` pulls the next forecast hour held for each spot, so the list
 * can say what the fishing looks like there rather than only how far away it
 * is. Its sub-pipeline is bounded by the (spotId, at) index and `$limit: 1`.
 */
export async function nearbySpots(
  db: Db,
  rawLat: unknown,
  rawLon: unknown,
  rawKm: unknown,
): Promise<NearbySpot[]> {
  // Missing means missing. `Number(null)` and `Number('')` are both 0, so
  // without this a request with no point would quietly search the Gulf of
  // Guinea and answer 200 with an empty list — the same trap `parseSpot`
  // guards against on the way in from the URL.
  const lat = blank(rawLat) ? NaN : Number(rawLat);
  const lon = blank(rawLon) ? NaN : Number(rawLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new SpotError(400, 'lat and lon must be numbers.');
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new SpotError(400, 'lat and lon are out of range.');
  }

  const km = rawKm === undefined || rawKm === null || rawKm === '' ? 25 : Number(rawKm);
  if (!Number.isFinite(km) || km <= 0 || km > 500) {
    throw new SpotError(400, 'km must be between 0 and 500.');
  }

  return spots(db)
    .aggregate<NearbySpot>([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lon, lat] },
          distanceField: 'distanceM',
          maxDistance: km * 1000,
          spherical: true,
          key: 'location',
        },
      },
      { $limit: 20 },
      {
        $lookup: {
          from: CONDITIONS,
          let: { id: '$_id', from: new Date() },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$spotId', '$$id'] }, { $gte: ['$at', '$$from'] }] } } },
            { $sort: { at: 1 } },
            { $limit: 1 },
            { $project: { _id: 0, at: 1, score: 1 } },
          ],
          as: 'next',
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: '$_id' },
          name: 1,
          lat: 1,
          lon: 1,
          distanceM: { $round: ['$distanceM', 0] },
          nextAt: { $first: '$next.at' },
          nextScore: { $first: '$next.score' },
        },
      },
    ])
    .toArray();
}
