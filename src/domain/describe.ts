import type { TimelinePoint } from '../api/types';
import type { LightWindow } from './daylight';
import { scoreHour } from './score';
import type { TideExtreme } from './tides';
import { epochToSpotTime } from './units';

/** Eight-point direction as anglers say it: "a light easterly". */
const BEARING_WORDS = [
  'northerly', 'north-easterly', 'easterly', 'south-easterly',
  'southerly', 'south-westerly', 'westerly', 'north-westerly',
] as const;

export function bearingWord(deg: number | null): string | null {
  if (deg === null || !Number.isFinite(deg)) return null;
  return BEARING_WORDS[Math.round(deg / 45) % 8];
}

/** Beaufort-ish strength word for a speed in knots. */
function strengthWord(kn: number): string {
  if (kn < 4) return 'barely any wind';
  if (kn < 9) return 'a light';
  if (kn < 16) return 'a moderate';
  if (kn < 23) return 'a fresh';
  if (kn < 31) return 'a strong';
  return 'a gale-force';
}

/**
 * How long the current conditions hold.
 *
 * Walks forward from now while the hour still scores at least as well as a
 * band boundary, and reports the hour it drops. Returns null when conditions
 * are already poor or hold past the end of the forecast.
 */
function holdsUntil(
  timeline: TimelinePoint[],
  extremes: TideExtreme[],
  now: number,
  currentScore: number,
  utcOffsetSeconds: number,
  light: LightWindow[] = [],
): string | null {
  // Only worth saying when there is something good to lose.
  if (currentScore < 55) return null;
  const floor = currentScore >= 75 ? 75 : 55;

  const forward = timeline.filter((p) => p.t >= now);
  for (let i = 1; i < forward.length; i++) {
    if (scoreHour(forward[i], extremes, light).score < floor) {
      return epochToSpotTime(forward[i].t, utcOffsetSeconds);
    }
  }
  return null;
}

/**
 * One sentence describing the moment, in the words an angler would use.
 *
 * Reads as speech rather than a readout — the numbers are already in the rows
 * directly beneath it, so repeating them here would be noise.
 */
export function describeConditions(
  point: TimelinePoint,
  extremes: TideExtreme[],
  timeline: TimelinePoint[],
  now: number,
  utcOffsetSeconds: number,
  score: number,
  light: LightWindow[] = [],
): string {
  const parts: string[] = [];

  if (point.tideRate !== null) {
    const rate = Math.abs(point.tideRate);
    if (rate < 0.04) parts.push('Slack water');
    else if (point.tideRate > 0) {
      parts.push(rate > 0.25 ? 'Tide running in hard' : 'Tide coming in');
    } else {
      parts.push(rate > 0.25 ? 'Tide running out hard' : 'Tide going out');
    }
  }

  if (point.windSpeed !== null) {
    const dir = bearingWord(point.windDir);
    const strength = strengthWord(point.windSpeed);
    parts.push(
      strength === 'barely any wind'
        ? 'barely any wind'
        : `${strength} ${dir ?? 'breeze'}`,
    );
  }

  if (point.precip !== null && point.precip >= 0.2) {
    parts.push(point.precip >= 3 ? 'heavy rain' : 'a bit of rain');
  }

  let sentence =
    parts.length > 0
      ? `${parts.join(', ').replace(/^./, (c) => c.toUpperCase())}.`
      : 'Conditions unavailable.';

  const until = holdsUntil(timeline, extremes, now, score, utcOffsetSeconds, light);
  if (until) sentence += ` Holds until about ${until}.`;

  return sentence;
}
