import type { ForecastResponse } from '../api/types';
import { wallClockToEpoch } from './timeline';

/**
 * When the sun is down, so the chart can say so.
 *
 * Fish feed on the change of light as much as on the change of tide, and a
 * reader picking a window wants to know which side of dawn it falls on. The
 * spine drew hours as an undifferentiated strip, leaving that to be worked out
 * from the clock labels.
 *
 * Taken from the model rather than computed here. The sun's position is pure
 * astronomy and could be derived, but Open-Meteo already returns it for the
 * exact coordinates and zone the rest of the forecast uses, and a second
 * source for the same fact is a second thing that can disagree.
 */
export interface Night {
  from: number;
  to: number;
  /** `from` is a real sunset, rather than the window opening in the dark. */
  fadeIn: boolean;
  /** `to` is a real sunrise, rather than the window closing in the dark. */
  fadeOut: boolean;
}

/** Sun centre at sunrise and sunset, allowing for refraction. */
const HORIZON_ALT = -0.833;

/** Civil twilight: first light in the morning, last light at night. */
const CIVIL_ALT = -6;

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Solar declination, by Spencer's Fourier series. Good to a few hundredths of
 * a degree, which is far more than the use below needs.
 */
function declination(t: number): number {
  const at = new Date(t);
  const dayOfYear = (t - Date.UTC(at.getUTCFullYear(), 0, 1)) / 86_400_000;
  const g = ((2 * Math.PI) / 365) * dayOfYear;

  return (
    0.006918 -
    0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) + 0.001480 * Math.sin(3 * g)
  );
}

/** How far from solar noon the sun sits at a given altitude, in radians. */
function hourAngle(altDeg: number, latRad: number, dec: number): number | null {
  const cosH =
    (Math.sin(rad(altDeg)) - Math.sin(latRad) * Math.sin(dec)) /
    (Math.cos(latRad) * Math.cos(dec));

  // Out of range means the sun never reaches that altitude on this day: a
  // polar summer where it never gets properly dark, or a polar winter where
  // it never gets properly light.
  return Number.isFinite(cosH) && cosH >= -1 && cosH <= 1 ? Math.acos(cosH) : null;
}

/**
 * How long civil twilight lasts here, as a duration either side of the model's
 * own sunrise and sunset.
 *
 * A difference rather than a pair of absolute times, and that is the whole
 * point. Open-Meteo has no twilight variable, so this has to be computed — but
 * computing dawn outright would put a second solar model beside the one the
 * sunrise came from, and the two would disagree by a few minutes in a way that
 * showed on the axis. Taking only the gap between two altitudes cancels most
 * of this model's own error, and leaves the absolute times where they were.
 *
 * Null where the sun does not cross both altitudes that day, which is the same
 * answer `nightSpans` gives when there is no sunrise at all: draw the hard
 * edge rather than guess at a soft one.
 */
export function twilightMs(lat: number, t: number): number | null {
  const dec = declination(t);
  const latRad = rad(lat);

  const horizon = hourAngle(HORIZON_ALT, latRad, dec);
  const civil = hourAngle(CIVIL_ALT, latRad, dec);
  if (horizon === null || civil === null) return null;

  return ((civil - horizon) * 12 * 3_600_000) / Math.PI;
}

/**
 * Sunrise and sunset as instants, from the daily block.
 *
 * The strings are local wall clock without an offset, the same shape as the
 * hourly stamps, so they convert the same way. Nulls are dropped rather than
 * defaulted: a polar day has no sunset, and inventing midnight for it would
 * shade half the chart for no reason.
 */
export function sunEvents(forecast: ForecastResponse, utcOffsetSeconds: number): {
  sunrises: number[];
  sunsets: number[];
} {
  const read = (stamps: (string | null)[] | undefined): number[] =>
    (stamps ?? [])
      .filter((s): s is string => typeof s === 'string')
      .map((s) => wallClockToEpoch(s, utcOffsetSeconds))
      .filter((t) => Number.isFinite(t));

  return {
    sunrises: read(forecast.daily?.sunrise),
    sunsets: read(forecast.daily?.sunset),
  };
}

/**
 * The stretches of darkness between `from` and `to`, clipped to it.
 *
 * Returns the dark rather than the light because the dark is what gets drawn:
 * one rectangle per night over a plain background is fewer marks than tiling
 * the whole axis, and it degrades correctly — with no sun data at all there
 * are no rectangles and the chart looks exactly as it did before.
 */
export function nightSpans(
  sunrises: number[],
  sunsets: number[],
  from: number,
  to: number,
): Night[] {
  const events = [
    ...sunrises.map((t) => ({ t, night: false })),
    ...sunsets.map((t) => ({ t, night: true })),
  ].sort((a, b) => a.t - b.t);

  if (events.length === 0 || to <= from) return [];

  // What the window opens in. The last event before it settles that; when it
  // opens before every event, the next one settles it by being the opposite.
  const prior = events.filter((e) => e.t <= from).at(-1);
  const next = events.find((e) => e.t > from);
  let night = prior ? prior.night : next ? !next.night : false;

  const spans: Night[] = [];
  let start = from;
  // Whether `start` is a sunset the reader can see, or just the left edge of
  // a window that opened after one. Only the former is worth fading.
  let fadeIn = false;

  for (const e of events) {
    if (e.t <= from || e.t >= to || e.night === night) continue;
    if (night) spans.push({ from: start, to: e.t, fadeIn, fadeOut: true });
    night = e.night;
    start = e.t;
    fadeIn = e.night;
  }
  if (night) spans.push({ from: start, to, fadeIn, fadeOut: false });

  return spans;
}

/** A stretch of changing light, as the scorer treats it. */
export interface LightWindow {
  from: number;
  to: number;
}

const HOUR = 3_600_000;

/**
 * The hours either side of first and last light.
 *
 * Lopsided on purpose, and in opposite directions: the morning window reaches
 * half an hour back and an hour and a half forward, the evening one an hour
 * and a half back and half an hour forward. Both are the same shape really —
 * the short side is the dark side.
 *
 * With no twilight figure the windows fall back to the model's own sunrise
 * and sunset. That is twenty-odd minutes off, but it is much closer than
 * having no window at all, which would put the whole day under the cap.
 */
export function lightWindows(
  sunrises: number[],
  sunsets: number[],
  twilight: number | null,
): LightWindow[] {
  const edge = twilight ?? 0;

  return [
    ...sunrises.map((t) => ({ from: t - edge - 0.5 * HOUR, to: t - edge + 1.5 * HOUR })),
    ...sunsets.map((t) => ({ from: t + edge - 1.5 * HOUR, to: t + edge + 0.5 * HOUR })),
  ].sort((a, b) => a.from - b.from);
}

/** Whether an instant falls inside any of them. */
export function inLight(windows: LightWindow[], t: number): boolean {
  return windows.some((w) => t >= w.from && t <= w.to);
}
