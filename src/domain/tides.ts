import type { TimelinePoint } from '../api/types';

export type TideKind = 'high' | 'low';

export interface TideExtreme {
  kind: TideKind;
  /** Epoch ms of the interpolated turning point. */
  t: number;
  /** Interpolated height at the turn, in metres relative to MSL. */
  height: number;
}

/**
 * Rate of tide change in metres per hour, by central difference.
 *
 * This is the strongest single signal in the fishing score: fish feed on
 * moving water and go quiet at slack tide. Sign carries direction — positive
 * is a rising (flood) tide, negative is falling (ebb).
 *
 * Assumes hourly samples, which is what the marine endpoint returns.
 */
export function deriveTideRates(heights: (number | null)[]): (number | null)[] {
  return heights.map((_, i) => {
    const prev = heights[i - 1];
    const next = heights[i + 1];
    const here = heights[i];
    if (here === null || here === undefined) return null;

    // Interior points: central difference over a 2-hour span.
    if (prev !== null && prev !== undefined && next !== null && next !== undefined) {
      return (next - prev) / 2;
    }
    // Edges (and gaps): fall back to a one-sided difference.
    if (next !== null && next !== undefined) return next - here;
    if (prev !== null && prev !== undefined) return here - prev;
    return null;
  });
}

/**
 * Locate high and low tides, refined to sub-hour precision.
 *
 * The marine model only publishes hourly sea levels, so taking the raw local
 * maximum would quantise every turn to the hour (+/-30 min). Fitting a parabola
 * through the extremum and its two neighbours and solving for the vertex
 * recovers the true turning point to within a few minutes, which is what
 * matters when you are planning to fish a tide change.
 */
export function findTideExtremes(points: TimelinePoint[]): TideExtreme[] {
  const extremes: TideExtreme[] = [];

  for (let i = 1; i < points.length - 1; i++) {
    const y0 = points[i - 1].tideHeight;
    const y1 = points[i].tideHeight;
    const y2 = points[i + 1].tideHeight;
    if (y0 === null || y1 === null || y2 === null) continue;

    const isHigh = y1 >= y0 && y1 >= y2;
    const isLow = y1 <= y0 && y1 <= y2;
    if (!isHigh && !isLow) continue;

    // Parabola through (-1, y0), (0, y1), (1, y2), in hours about point i.
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) < 1e-6) continue; // Degenerate / flat: no distinct turn.

    const offsetHours = (y0 - y2) / (2 * denom);
    // A genuine turning point sits between the two neighbours. Anything else
    // means this is a plateau or the series is noisy — skip it.
    if (!Number.isFinite(offsetHours) || Math.abs(offsetHours) > 1) continue;

    // Vertex height: y1 - (y2-y0)^2 / (8*denom), rewritten in terms of the
    // offset we already solved for.
    const height = y1 + ((y2 - y0) * offsetHours) / 4;
    const t = points[i].t + offsetHours * 3600_000;

    // Guard against duplicates when a flat top spans two samples.
    const last = extremes[extremes.length - 1];
    if (last && last.kind === (isHigh ? 'high' : 'low') && t - last.t < 3600_000) {
      continue;
    }

    extremes.push({ kind: isHigh ? 'high' : 'low', t, height });
  }

  return extremes;
}

/** The tide change immediately before and after a moment in time. */
export function surroundingTides(
  extremes: TideExtreme[],
  t: number,
): { prev: TideExtreme | null; next: TideExtreme | null } {
  let prev: TideExtreme | null = null;
  let next: TideExtreme | null = null;
  for (const e of extremes) {
    if (e.t <= t) prev = e;
    else {
      next = e;
      break;
    }
  }
  return { prev, next };
}

/** Hours to the nearest tide change, or null if none is known nearby. */
export function hoursToNearestTurn(
  extremes: TideExtreme[],
  t: number,
): number | null {
  const { prev, next } = surroundingTides(extremes, t);
  const gaps: number[] = [];
  if (prev) gaps.push((t - prev.t) / 3600_000);
  if (next) gaps.push((next.t - t) / 3600_000);
  if (gaps.length === 0) return null;
  return Math.min(...gaps);
}
