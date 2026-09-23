import type { TimelinePoint } from '../api/types';
import type { LightWindow } from './daylight';
import { scoreHour, type FactorKey } from './score';
import type { TideExtreme } from './tides';

/**
 * Turning what is on screen into something worth keeping.
 *
 * The scores are the ones the page is already drawn with — `scoreHour` over
 * the same timeline and the same tide extremes — rather than being derived
 * again on the server. A stored hour and a displayed hour cannot disagree
 * because there is only one calculation.
 */

/** How far ahead to keep. The app draws two days; beyond that it thins out. */
export const SNAPSHOT_HOURS = 48;

export interface SnapshotHour {
  /** The forecast hour as a real instant, ISO 8601. */
  at: string;
  score: number;
  unfishable: boolean;
  /** Each 0-1, or null where the model had no reading to normalise. */
  factors: Record<FactorKey, number | null>;
  windKn: number | null;
  gustKn: number | null;
  waveM: number | null;
  /** The swell the score actually read, alongside the combined sea above. */
  swellM: number | null;
  tideRate: number | null;
  rainMm: number | null;
  cloudPct: number | null;
}

/**
 * The next `hours` hours of the timeline, scored and flattened for storage.
 *
 * Only hours from `now` forward: the past is already recorded, and re-sending
 * it every time a spot is opened would be a lot of writes to change nothing.
 * Hours the model left blank are skipped rather than stored as zeros — a
 * missing reading is not a calm one.
 */
export function snapshotHours(
  timeline: TimelinePoint[],
  extremes: TideExtreme[],
  now: number,
  hours: number = SNAPSHOT_HOURS,
  light: LightWindow[] = [],
): SnapshotHour[] {
  const out: SnapshotHour[] = [];

  for (const point of timeline) {
    if (point.t < now) continue;
    if (out.length >= hours) break;

    const scored = scoreHour(point, extremes, light);
    // `partial` means the score was assembled from an incomplete reading. It
    // is honest enough to show with a caveat, but not to average over later.
    if (scored.partial) continue;

    const factors = {} as Record<FactorKey, number | null>;
    for (const factor of scored.factors) factors[factor.key] = factor.value;

    out.push({
      at: new Date(point.t).toISOString(),
      score: scored.score,
      unfishable: scored.unfishable,
      factors,
      windKn: point.windSpeed,
      gustKn: point.windGust,
      waveM: point.waveHeight,
      swellM: point.swellHeight,
      tideRate: point.tideRate,
      rainMm: point.precip,
      cloudPct: point.cloudCover,
    });
  }

  return out;
}
