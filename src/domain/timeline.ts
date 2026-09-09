import type {
  ForecastResponse,
  MarineResponse,
  TimelinePoint,
} from '../api/types';
import { deriveTideRates } from './tides';

/**
 * Convert an Open-Meteo local wall-clock stamp into a true epoch.
 *
 * The API returns times in the *spot's* timezone with no offset suffix, so
 * `Date.parse` would read them in the browser's timezone instead. Viewing a
 * Perth spot from Sydney would then be two hours out. Reading the stamp as UTC
 * and subtracting the reported offset recovers the real instant.
 */
export function wallClockToEpoch(stamp: string, utcOffsetSeconds: number): number {
  return Date.parse(`${stamp}Z`) - utcOffsetSeconds * 1000;
}

/**
 * Merge the atmospheric and marine series into one hourly timeline.
 *
 * The two endpoints are independent requests and their `time` arrays are not
 * guaranteed to share a length or a start hour, so marine values are joined by
 * timestamp rather than by index. Hours with no marine coverage keep null wave
 * and tide fields, which the UI renders as gaps rather than zeros.
 */
export function buildTimeline(
  forecast: ForecastResponse,
  marine: MarineResponse | null,
): TimelinePoint[] {
  const offset = forecast.utc_offset_seconds;
  const fh = forecast.hourly;

  // Index marine hours by wall-clock stamp for the join.
  const marineIndex = new Map<string, number>();
  if (marine) {
    marine.hourly.time.forEach((stamp, i) => marineIndex.set(stamp, i));
  }

  // Tide rate needs the marine series in its own order, before the join.
  const tideRates = marine
    ? deriveTideRates(marine.hourly.sea_level_height_msl)
    : [];

  return fh.time.map((stamp, i) => {
    const m = marineIndex.get(stamp);
    const mh = marine?.hourly;

    return {
      time: stamp,
      t: wallClockToEpoch(stamp, offset),
      windSpeed: fh.wind_speed_10m[i] ?? null,
      windGust: fh.wind_gusts_10m[i] ?? null,
      windDir: fh.wind_direction_10m[i] ?? null,
      precip: fh.precipitation[i] ?? null,
      precipProb: fh.precipitation_probability[i] ?? null,
      temp: fh.temperature_2m[i] ?? null,
      waveHeight: m === undefined ? null : mh!.wave_height[m] ?? null,
      wavePeriod: m === undefined ? null : mh!.wave_period[m] ?? null,
      waveDir: m === undefined ? null : mh!.wave_direction[m] ?? null,
      swellHeight: m === undefined ? null : mh!.swell_wave_height[m] ?? null,
      swellPeriod: m === undefined ? null : mh!.swell_wave_period[m] ?? null,
      tideHeight: m === undefined ? null : mh!.sea_level_height_msl[m] ?? null,
      tideRate: m === undefined ? null : tideRates[m] ?? null,
    };
  });
}

/** Index of the timeline hour closest to `now`, or -1 for an empty timeline. */
export function currentIndex(points: TimelinePoint[], now = Date.now()): number {
  if (points.length === 0) return -1;
  let best = 0;
  let bestGap = Infinity;
  for (let i = 0; i < points.length; i++) {
    const gap = Math.abs(points[i].t - now);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}
