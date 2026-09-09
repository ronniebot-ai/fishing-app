import type { TimelinePoint } from '../api/types';
import { hoursToNearestTurn, type TideExtreme } from './tides';

/**
 * Relative importance of each factor. Exported so the weighting stays a tuning
 * knob rather than a magic number buried in the maths.
 *
 * Tide leads deliberately: moving water is the strongest, most consistent
 * driver of feeding activity. Wind comes next because it decides whether the
 * trip is comfortable or even possible.
 */
export const SCORE_WEIGHTS = {
  tide: 0.4,
  wind: 0.28,
  wave: 0.2,
  rain: 0.12,
} as const;

/** Conditions beyond these are unsafe or unfishable regardless of everything else. */
export const GATES = {
  windMaxKn: 30,
  waveMaxM: 3,
  /** Score ceiling applied when a gate trips. */
  cappedScore: 20,
} as const;

/** Lowest a single factor can contribute, so one zero cannot annihilate the product. */
const FACTOR_FLOOR = 0.02;

/**
 * How far the worst factor can pull the composite down. At 0.45, a completely
 * blown-out factor cuts the score by a little over half; a clean day is
 * unaffected.
 */
const LIMITING_FLOOR = 0.45;

export type FactorKey = 'tide' | 'wind' | 'wave' | 'rain';

export interface FactorScore {
  key: FactorKey;
  label: string;
  /** Normalised 0-1 quality for this factor, or null when data is missing. */
  value: number | null;
  /** Short human explanation of what drove the value. */
  detail: string;
}

export interface FishingScore {
  /** 0-100 composite. */
  score: number;
  factors: FactorScore[];
  /** True when a hard gate tripped (dangerous wind or sea). */
  unfishable: boolean;
  /** Set when a gate tripped, explaining which. */
  gateReason: string | null;
  /** True when marine data was unavailable and the score uses wind/rain only. */
  partial: boolean;
}

/**
 * Linear interpolation across a curve defined by [input, quality] breakpoints.
 * Values outside the range clamp to the nearest endpoint.
 */
export function piecewise(x: number, curve: readonly (readonly [number, number])[]): number {
  if (x <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (x >= last[0]) return last[1];

  for (let i = 0; i < curve.length - 1; i++) {
    const [x0, y0] = curve[i];
    const [x1, y1] = curve[i + 1];
    if (x >= x0 && x <= x1) {
      const span = x1 - x0;
      if (span === 0) return y1;
      return y0 + ((y1 - y0) * (x - x0)) / span;
    }
  }
  return last[1];
}

/** Light winds are best; past ~25 kn most shore and small-boat fishing is done. */
const WIND_CURVE = [
  [0, 1],
  [10, 1],
  [15, 0.78],
  [20, 0.5],
  [25, 0.25],
  [30, 0.06],
  [40, 0.02],
] as const;

/**
 * A little swell stirs food and gives fish confidence; dead flat is slow and
 * anything over ~2 m makes most spots unworkable.
 */
const WAVE_CURVE = [
  [0, 0.55],
  [0.2, 0.8],
  [0.3, 1],
  [1.2, 1],
  [2, 0.55],
  [3, 0.15],
  [5, 0.05],
] as const;

/** Absolute tide rate in m/hr. Slack water is poor, a strong run is prime. */
const TIDE_CURVE = [
  [0, 0.25],
  [0.05, 0.4],
  [0.1, 0.55],
  [0.2, 0.8],
  [0.35, 1],
  [1, 1],
] as const;

/** Drizzle is often better than clear; heavy rain kills it. */
const RAIN_CURVE = [
  [0, 0.92],
  [0.2, 1],
  [1, 0.9],
  [3, 0.65],
  [6, 0.4],
  [12, 0.2],
  [25, 0.1],
] as const;

/**
 * Extra credit for fishing the run either side of a tide change — the window
 * anglers actually target. It peaks about 1.5 h off the turn and is zero at
 * dead slack, where the rate factor has already marked the water down.
 */
function turnBonus(hoursToTurn: number | null): number {
  if (hoursToTurn === null) return 0;
  if (hoursToTurn < 0.5 || hoursToTurn > 3) return 0;
  const distanceFromPeak = Math.abs(hoursToTurn - 1.5);
  return 0.15 * Math.max(0, 1 - distanceFromPeak / 1.5);
}

function compass(deg: number | null): string {
  if (deg === null) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

/**
 * Score one hour of conditions.
 *
 * Factors combine as a *weighted geometric mean*, not an average: a single
 * terrible factor has to drag the whole result down. Thirty knots of wind
 * should not be rescued by a perfect tide, which is exactly what an arithmetic
 * mean would do.
 */
export function scoreHour(
  point: TimelinePoint,
  extremes: TideExtreme[] = [],
): FishingScore {
  const factors: FactorScore[] = [];

  // --- Tide ---
  if (point.tideRate !== null) {
    const rate = Math.abs(point.tideRate);
    const base = piecewise(rate, TIDE_CURVE);
    const bonus = turnBonus(hoursToNearestTurn(extremes, point.t));
    const direction = point.tideRate > 0.01 ? 'rising' : point.tideRate < -0.01 ? 'falling' : 'slack';
    factors.push({
      key: 'tide',
      label: 'Tide',
      value: Math.min(1, base + bonus),
      detail:
        direction === 'slack'
          ? 'Slack water — little movement'
          : `${direction === 'rising' ? 'Rising' : 'Falling'} ${rate.toFixed(2)} m/hr`,
    });
  } else {
    factors.push({ key: 'tide', label: 'Tide', value: null, detail: 'No tide data' });
  }

  // --- Wind ---
  if (point.windSpeed !== null) {
    const gustNote = point.windGust !== null ? `, gusts ${Math.round(point.windGust)} kn` : '';
    factors.push({
      key: 'wind',
      label: 'Wind',
      value: piecewise(point.windSpeed, WIND_CURVE),
      detail: `${compass(point.windDir)} ${Math.round(point.windSpeed)} kn${gustNote}`,
    });
  } else {
    factors.push({ key: 'wind', label: 'Wind', value: null, detail: 'No wind data' });
  }

  // --- Wave ---
  if (point.waveHeight !== null) {
    const periodNote = point.wavePeriod !== null ? ` @ ${point.wavePeriod.toFixed(0)} s` : '';
    factors.push({
      key: 'wave',
      label: 'Swell',
      value: piecewise(point.waveHeight, WAVE_CURVE),
      detail: `${point.waveHeight.toFixed(1)} m${periodNote}`,
    });
  } else {
    factors.push({ key: 'wave', label: 'Swell', value: null, detail: 'No swell data' });
  }

  // --- Rain ---
  if (point.precip !== null) {
    const probNote = point.precipProb !== null ? ` (${Math.round(point.precipProb)}% chance)` : '';
    factors.push({
      key: 'rain',
      label: 'Rain',
      value: piecewise(point.precip, RAIN_CURVE),
      detail: point.precip < 0.05 ? `Dry${probNote}` : `${point.precip.toFixed(1)} mm/hr${probNote}`,
    });
  } else {
    factors.push({ key: 'rain', label: 'Rain', value: null, detail: 'No rain data' });
  }

  // Weighted geometric mean over the factors that actually have data.
  let logSum = 0;
  let weightSum = 0;
  for (const f of factors) {
    if (f.value === null) continue;
    const w = SCORE_WEIGHTS[f.key];
    logSum += w * Math.log(Math.max(f.value, FACTOR_FLOOR));
    weightSum += w;
  }

  // A weighted geometric mean alone still under-reacts: raising a factor to
  // its weight compresses it heavily (0.14 wind at weight 0.28 only becomes a
  // 0.55 multiplier), so a gale would still score in the fifties. Scaling by
  // the worst factor makes the limiting condition actually limit the result,
  // while leaving a day with nothing bad in it untouched (worst = 1 -> x1.0).
  const present = factors.filter((f) => f.value !== null);
  const worst = present.length > 0 ? Math.min(...present.map((f) => f.value!)) : 0;
  const limiting = LIMITING_FLOOR + (1 - LIMITING_FLOOR) * worst;

  let score = weightSum > 0 ? Math.exp(logSum / weightSum) * limiting * 100 : 0;

  // Hard safety gates override the blend entirely.
  let gateReason: string | null = null;
  if (point.windSpeed !== null && point.windSpeed > GATES.windMaxKn) {
    gateReason = `Wind over ${GATES.windMaxKn} kn`;
  } else if (point.waveHeight !== null && point.waveHeight > GATES.waveMaxM) {
    gateReason = `Swell over ${GATES.waveMaxM} m`;
  }
  if (gateReason) score = Math.min(score, GATES.cappedScore);

  return {
    score: Math.round(score),
    factors,
    unfishable: gateReason !== null,
    gateReason,
    partial: point.waveHeight === null && point.tideHeight === null,
  };
}

export interface FishingWindow {
  startT: number;
  endT: number;
  /** Mean score across the window. */
  score: number;
  /** Best single hour inside the window. */
  peakT: number;
}

/**
 * Pick the strongest contiguous fishing windows in the timeline.
 *
 * Hours scoring at least `threshold` are grouped into runs, short runs are
 * dropped, and the runs are returned strongest-first.
 */
export function findBestWindows(
  points: TimelinePoint[],
  extremes: TideExtreme[],
  options: {
    limit?: number;
    threshold?: number;
    horizonHours?: number;
    /** Reference time; injected so callers stay pure and testable. */
    now?: number;
  } = {},
): FishingWindow[] {
  const { limit = 3, threshold = 55, horizonHours = 48, now = Date.now() } = options;
  const cutoff = now + horizonHours * 3600_000;

  const scored = points
    .filter((p) => p.t >= now - 3600_000 && p.t <= cutoff)
    .map((p) => ({ point: p, result: scoreHour(p, extremes) }));

  const windows: FishingWindow[] = [];
  let run: typeof scored = [];

  const flush = () => {
    // A window needs at least two hours to be worth driving to.
    if (run.length >= 2) {
      const best = run.reduce((a, b) => (b.result.score > a.result.score ? b : a));
      windows.push({
        startT: run[0].point.t,
        endT: run[run.length - 1].point.t + 3600_000,
        score: Math.round(run.reduce((s, r) => s + r.result.score, 0) / run.length),
        peakT: best.point.t,
      });
    }
    run = [];
  };

  for (const entry of scored) {
    if (entry.result.score >= threshold && !entry.result.unfishable) run.push(entry);
    else flush();
  }
  flush();

  return windows.sort((a, b) => b.score - a.score).slice(0, limit);
}
