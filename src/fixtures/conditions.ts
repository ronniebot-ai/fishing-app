import type { TimelinePoint } from '../api/types';
import { findBestWindows, scoreHour } from '../domain/score';
import { wallClockToEpoch } from '../domain/timeline';
import { lightWindows, twilightMs } from '../domain/daylight';
import { deriveTideRates, findTideExtremes } from '../domain/tides';

/**
 * Sample conditions shared by component tests and Storybook stories.
 *
 * The hourly readings below are hand-built, but nothing derived from them is:
 * rates, tide turns, scores and windows all come from the real domain
 * functions. A fixture with an invented score would drift away from what the
 * app computes and quietly stop describing it.
 */

/** Sydney in September — AEST, ten hours ahead. */
export const SYDNEY_UTC_OFFSET = 10 * 3600;

/** Wall-clock stamp for hour `i` of 7 September 2026, in the spot's zone. */
const stampAt = (i: number) => `2026-09-07T${String(i).padStart(2, '0')}:00`;

/** Hourly sea level in metres relative to MSL — two highs and a low. */
const TIDE_HEIGHTS = [
  -0.29, -0.12, 0.08, 0.25, 0.34, 0.33, 0.22, 0.07,
  -0.1, -0.21, -0.24, -0.15, 0.04, 0.3, 0.59, 0.83,
  0.96, 0.96, 0.79, 0.54, 0.23, -0.07, -0.3, -0.42,
];

/** A day that eases off: a blustery dawn settling into a calm afternoon. */
const WIND_SPEED = [
  22, 21, 20, 19, 18, 17, 16, 14,
  12, 11, 10, 9, 8, 8, 7, 7,
  8, 9, 10, 12, 14, 16, 18, 19,
];

const WAVE_HEIGHT = [
  2.1, 2.0, 1.9, 1.8, 1.7, 1.6, 1.5, 1.4,
  1.3, 1.2, 1.1, 1.0, 0.9, 0.9, 0.8, 0.8,
  0.9, 1.0, 1.1, 1.3, 1.5, 1.7, 1.9, 2.0,
];

/** Overcast dawn burning off to a bright afternoon, clouding over at dusk. */
const CLOUD_COVER = [
  95, 95, 92, 90, 88, 85, 80, 72,
  60, 45, 30, 20, 15, 12, 15, 22,
  35, 48, 62, 75, 84, 90, 93, 95,
];

/** Rain clears through the morning. */
const PRECIP_PROB = [
  60, 55, 50, 45, 40, 35, 25, 20,
  15, 10, 5, 4, 3, 2, 2, 2,
  4, 8, 12, 18, 25, 30, 35, 40,
];

function buildTimeline(): TimelinePoint[] {
  const rates = deriveTideRates(TIDE_HEIGHTS);

  return TIDE_HEIGHTS.map((tideHeight, i) => ({
    time: stampAt(i),
    // A true epoch derived the same way the app derives it, so rendering `t`
    // back through `epochToSpotTime` returns the wall clock it came from.
    t: wallClockToEpoch(stampAt(i), SYDNEY_UTC_OFFSET),
    windSpeed: WIND_SPEED[i],
    windGust: WIND_SPEED[i] + 6,
    windDir: 155,
    precip: PRECIP_PROB[i] > 30 ? 0.6 : 0,
    precipProb: PRECIP_PROB[i],
    cloudCover: CLOUD_COVER[i],
    temp: 18,
    waveHeight: WAVE_HEIGHT[i],
    wavePeriod: 9,
    waveDir: 140,
    swellHeight: WAVE_HEIGHT[i] * 0.8,
    swellPeriod: 11,
    // South-easterly, the prevailing swell on this coast.
    swellDir: 140,
    tideHeight,
    tideRate: rates[i],
  }));
}

export const timeline = buildTimeline();
export const extremes = findTideExtremes(timeline);

/** Sydney's latitude, so the twilight length matches the sun times below. */
export const SYDNEY_LAT = -33.8908;

/**
 * Sydney in early September, a fortnight before daylight saving: the sun is
 * up a little after six and down before six. Stated rather than derived, the
 * way the readings above are — the spine only wants two instants.
 */
export const sunrises = [wallClockToEpoch('2026-09-07T06:14', SYDNEY_UTC_OFFSET)];
export const sunsets = [wallClockToEpoch('2026-09-07T17:39', SYDNEY_UTC_OFFSET)];

/**
 * The dawn and dusk windows, roughly 5:18-7:18am and 4:34-6:34pm.
 *
 * Every score below is built with these, because every score in the app is:
 * a fixture that skipped them would be a day where every hour could reach
 * Prime, which is not a day this app can produce.
 */
export const light = lightWindows(sunrises, sunsets, twilightMs(SYDNEY_LAT, sunrises[0]));

/** 3pm: calm and bright, but hours off the light — a capped afternoon. */
export const nowPoint = timeline[15];
export const NOW = nowPoint.t;
export const score = scoreHour(nowPoint, extremes, light);

/** 6pm: last light with the tide a third of the way out. The day's best. */
export const primePoint = timeline[18];
export const primeScore = scoreHour(primePoint, extremes, light);

/** Ranked from the start of the day so all three windows fall in the horizon. */
export const windows = findBestWindows(timeline, extremes, { now: timeline[0].t, light });

/** Midnight, blowing 22 kn at the top of the tide — the worst hour here. */
export const roughPoint = timeline[0];
export const roughScore = scoreHour(roughPoint, extremes, light);

/**
 * A hard gate tripped — wind past the point where the score stops mattering.
 * Built through `scoreHour` so the gate reason is the app's own wording.
 */
export const gatedScore = scoreHour(
  { ...nowPoint, windSpeed: 42, windGust: 55, waveHeight: 5.4 },
  extremes,
);

/** Inland: no ocean cell was reachable, so every marine field is null. */
export const inlandPoint: TimelinePoint = {
  ...nowPoint,
  waveHeight: null,
  wavePeriod: null,
  waveDir: null,
  swellHeight: null,
  swellPeriod: null,
  tideHeight: null,
  tideRate: null,
};
export const inlandScore = scoreHour(inlandPoint, []);
