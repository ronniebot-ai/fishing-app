import type { TimelinePoint } from '../api/types';
import { inLight, type LightWindow } from './daylight';
import { surroundingTides, type TideExtreme } from './tides';
import { scoreBand } from './units';

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
  weather: 0.12,
  windDir: 0.06,
} as const;

/** Conditions beyond these are unsafe or unfishable regardless of everything else. */
export const GATES = {
  windMaxKn: 30,
  waveMaxM: 3,
  /** Score ceiling applied when a gate trips. */
  cappedScore: 20,
} as const;

/**
 * The best an hour outside the change of light can do.
 *
 * Sitting just under Prime, which starts at 75. Fish feed hardest as the
 * light turns, and a flawless midday tide is still a midday tide — this says
 * so in the only way the rest of the app already understands, by capping the
 * composite the way a tripped gate does.
 */
export const DAYLIGHT_CAP = 74;

/**
 * The small hours, and what they cost.
 *
 * Midnight to four, in the spot's own time. Not a statement about the fish —
 * it is a flat discouragement from being on the rocks at two in the morning,
 * and it is a subtraction rather than a cap so that a genuinely good night
 * still reads better than a bad one.
 */
export const DEAD_OF_NIGHT = { fromHour: 0, toHour: 4, penalty: 10 } as const;

/**
 * The hour on the spot's own clock, read off the wall-clock stamp rather than
 * from `t`. The stamp is already local — the forecast is fetched with
 * `timezone=auto` — so there is no offset to apply and none to get wrong.
 */
function localHour(time: string): number | null {
  const hour = Number(time.slice(11, 13));
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

/** Lowest a single factor can contribute, so one zero cannot annihilate the product. */
const FACTOR_FLOOR = 0.02;

/**
 * How far the worst factor can pull the composite down. At 0.45, a completely
 * blown-out factor cuts the score by a little over half; a clean day is
 * unaffected.
 */
const LIMITING_FLOOR = 0.45;

export type FactorKey = 'tide' | 'wind' | 'wave' | 'weather' | 'windDir';

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
  /** True when the hour fell outside the change of light and was capped. */
  offPeak: boolean;
  /** True when the hour fell between midnight and four, and was docked. */
  deadOfNight: boolean;
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

/**
 * Wind in knots, from thresholds given in km/h: under 25 km/h is good, 25-40
 * fair, over 40 poor. That is 13.5 and 21.6 kn. The readings stay in knots,
 * which is what Australian marine forecasts and everything else here use.
 */
const WIND_CURVE = [
  [0, 1],
  [13.5, 1],
  [14.8, 0.55],
  [21.6, 0.55],
  [23, 0.15],
  [32, 0.04],
] as const;

/**
 * Swell height in metres, read against where it is coming from.
 *
 * An easterly runs straight in off open water, so it only has to be small to
 * be workable. A southerly or northerly arrives at an angle and wants a bit
 * of size behind it before it does anything useful. A westerly is offshore
 * here: whatever its height, the water in close is flat and the number says
 * nothing, so it scores the middle and gets out of the way.
 */
const SWELL_EAST_CURVE = [
  [0, 1],
  [0.8, 1],
  [0.9, 0.55],
  [1.0, 0.55],
  [1.15, 0.15],
  [4, 0.05],
] as const;

const SWELL_MERIDIONAL_CURVE = [
  [0, 0.55],
  [0.75, 0.55],
  [0.85, 1],
  [1.05, 1],
  [1.2, 0.15],
  [4, 0.05],
] as const;

/** Whatever a westerly is doing, it is doing it somewhere else. */
const SWELL_WEST_VALUE = 0.55;

/**
 * Wind direction, which is a preference rather than a condition.
 *
 * A westerly is offshore on this coast: it flattens the water in close and
 * blows the chop away from you. An easterly does the opposite. But which way
 * that cuts depends entirely on which bank you are standing on, so the whole
 * factor is carried at a small weight and the spread between best and worst
 * is narrow — enough to break a tie, not enough to decide a day.
 */
const WIND_DIR_VALUE: Record<Sector, number> = {
  west: 1,
  meridional: 0.7,
  east: 0.45,
};

/**
 * Where an hour sits between one tide change and the next, 0 to 1.
 *
 * Two peaks, a third of the way in from each end, with a dip between them.
 * That is not the rate curve it replaces: the fastest water is at the middle,
 * and the middle is deliberately only fair here. Slack at either end is the
 * worst of it, which is the one thing both readings agree on.
 */
const TIDE_PHASE_CURVE = [
  [0, 0.1],
  [1 / 3, 1],
  [0.5, 0.6],
  [2 / 3, 1],
  [1, 0.1],
] as const;

/**
 * Cloud cover, 0-100%. Overcast is the best of it and hard sun the worst,
 * though "worst" here is still the middle of the scale — this is weather, not
 * wind, and it does not decide a day on its own.
 */
const CLOUD_CURVE = [
  [0, 0.55],
  [25, 0.6],
  [55, 1],
  [100, 1],
] as const;

/** Rain caps whatever the cloud was worth. */
const RAIN_CURVE = [
  [0, 1],
  [0.05, 1],
  [0.3, 0.6],
  [1.5, 0.25],
  [5, 0.1],
] as const;

type Sector = 'east' | 'west' | 'meridional';

/** Four quadrants on the cardinal points; everything but east and west is one case. */
function sector(deg: number | null): Sector {
  if (deg === null) return 'meridional';
  const d = ((deg % 360) + 360) % 360;
  if (d >= 45 && d < 135) return 'east';
  if (d >= 225 && d < 315) return 'west';
  return 'meridional';
}

/** Where `t` sits between the tide changes either side of it, or null. */
export function tidePhase(extremes: TideExtreme[], t: number): number | null {
  const { prev, next } = surroundingTides(extremes, t);
  if (!prev || !next || next.t <= prev.t) return null;
  return (t - prev.t) / (next.t - prev.t);
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
  light: LightWindow[] = [],
): FishingScore {
  const factors: FactorScore[] = [];

  // --- Tide ---
  const phase = tidePhase(extremes, point.t);
  if (phase !== null) {
    const rising = point.tideRate === null ? null : point.tideRate > 0;
    const run = rising === null ? 'Tide' : rising ? 'Rising' : 'Falling';
    // Thirds read better than a percentage: "a third of the way in" is how
    // the water is actually talked about.
    const third = phase < 1 / 3 ? 'first third' : phase < 2 / 3 ? 'middle' : 'last third';
    factors.push({
      key: 'tide',
      label: 'Tide',
      value: piecewise(phase, TIDE_PHASE_CURVE),
      detail: `${run}, ${third} of the run`,
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

  // --- Swell ---
  if (point.swellHeight !== null) {
    const from = sector(point.swellDir);
    const value =
      from === 'west'
        ? SWELL_WEST_VALUE
        : piecewise(
            point.swellHeight,
            from === 'east' ? SWELL_EAST_CURVE : SWELL_MERIDIONAL_CURVE,
          );
    const bearing = point.swellDir === null ? '' : `${compass(point.swellDir)} `;
    const periodNote = point.swellPeriod !== null ? ` @ ${point.swellPeriod.toFixed(0)} s` : '';
    factors.push({
      key: 'wave',
      label: 'Swell',
      value,
      detail: `${bearing}${point.swellHeight.toFixed(1)} m${periodNote}`,
    });
  } else {
    factors.push({ key: 'wave', label: 'Swell', value: null, detail: 'No swell data' });
  }

  // --- Wind direction ---
  if (point.windDir !== null) {
    const from = sector(point.windDir);
    factors.push({
      key: 'windDir',
      label: 'Wind direction',
      value: WIND_DIR_VALUE[from],
      detail:
        from === 'west' ? `${compass(point.windDir)} — offshore, water flat in close`
        : from === 'east' ? `${compass(point.windDir)} — onshore, chop into the bank`
        : `${compass(point.windDir)} — along the coast`,
    });
  } else {
    factors.push({ key: 'windDir', label: 'Wind direction', value: null, detail: 'No wind data' });
  }

  // --- Weather ---
  if (point.precip !== null || point.cloudCover !== null) {
    // Rain caps whatever the cloud was worth rather than averaging with it:
    // a wet overcast hour is a wet hour.
    const cloud = point.cloudCover === null ? 0.6 : piecewise(point.cloudCover, CLOUD_CURVE);
    const dry = point.precip === null ? 1 : piecewise(point.precip, RAIN_CURVE);
    const wet = point.precip !== null && point.precip >= 0.05;
    const probNote = point.precipProb !== null ? ` (${Math.round(point.precipProb)}% chance)` : '';
    const sky =
      point.cloudCover === null ? 'Cloud unknown'
      : point.cloudCover >= 55 ? 'Overcast'
      : point.cloudCover >= 25 ? 'Partly cloudy'
      : 'Clear';
    factors.push({
      key: 'weather',
      label: 'Weather',
      value: Math.min(cloud, dry),
      detail: wet ? `${sky}, ${point.precip!.toFixed(1)} mm/hr${probNote}` : `${sky}${probNote}`,
    });
  } else {
    factors.push({ key: 'weather', label: 'Weather', value: null, detail: 'No weather data' });
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
  // Wind direction is left out of this on purpose. It is a preference, not a
  // hazard, and the limiting term ignores weight — letting a mild nudge sit at
  // 0.45 here would cap the composite as hard as a gale does, which is the
  // opposite of carrying it at a small weight.
  const present = factors.filter((f) => f.value !== null && f.key !== 'windDir');
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

  // Outside the change of light, nothing reaches Prime. An empty `light` means
  // the sun times were never fetched rather than that it is never dawn, so the
  // cap stays off — a missing input must not quietly mark the whole week down.
  const offPeak = light.length > 0 && !inLight(light, point.t);
  if (offPeak) score = Math.min(score, DAYLIGHT_CAP);

  // Last, and taken off whatever survived the caps above rather than folded
  // into the blend: this is a flat discouragement, not a condition.
  const hour = localHour(point.time);
  const deadOfNight =
    hour !== null && hour >= DEAD_OF_NIGHT.fromHour && hour < DEAD_OF_NIGHT.toHour;
  if (deadOfNight) score = Math.max(0, score - DEAD_OF_NIGHT.penalty);

  return {
    score: Math.round(score),
    factors,
    unfishable: gateReason !== null,
    gateReason,
    offPeak,
    deadOfNight,
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
    light?: LightWindow[];
  } = {},
): FishingWindow[] {
  const { limit = 3, threshold = 55, horizonHours = 48, now = Date.now(), light = [] } = options;
  const cutoff = now + horizonHours * 3600_000;

  const scored = points
    .filter((p) => p.t >= now - 3600_000 && p.t <= cutoff)
    .map((p) => ({ point: p, result: scoreHour(p, extremes, light) }));

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

export interface ScoreRun {
  from: number;
  /** Exclusive: the end of the last hour in the run, not its start. */
  to: number;
  tone: 'fair' | 'good' | 'prime';
}

/**
 * Consecutive hours that share a score band, with the poor ones left out.
 *
 * This is what the spine shades with, and it is deliberately not
 * `findBestWindows`. That picks the three strongest runs over a fixed horizon
 * and is the answer to "where should I go"; this is every hour that is worth
 * anything at all, which is the answer to "what does this stretch look like".
 * A chart that only marked the top three would go blank over a good week.
 *
 * Poor hours get no mark rather than a fourth colour. Absence reads faster
 * than a fourth thing to learn, and it leaves the drawing quiet on the days
 * there is nothing to say.
 */
export function scoreRuns(
  points: TimelinePoint[],
  extremes: TideExtreme[],
  light: LightWindow[] = [],
): ScoreRun[] {
  const runs: ScoreRun[] = [];

  for (const point of points) {
    const { tone } = scoreBand(scoreHour(point, extremes, light).score);
    if (tone === 'poor') continue;

    const last = runs.at(-1);
    // Hours join only where they actually touch. A gap in the timeline is a
    // gap in what is known, and painting across it would invent an hour.
    if (last && last.tone === tone && last.to === point.t) {
      last.to = point.t + 3600_000;
    } else {
      runs.push({ from: point.t, to: point.t + 3600_000, tone });
    }
  }

  return runs;
}
