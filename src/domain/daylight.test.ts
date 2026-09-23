/**
 * The shading is decoration, but wrong shading is a lie about when it was
 * dark, so the interval maths is worth pinning down — particularly the ends,
 * where the drawn window almost never lines up with a sun crossing.
 */
import { describe, expect, it } from 'vitest';
import type { ForecastResponse } from '../api/types';
import { nightSpans, sunEvents, twilightMs } from './daylight';

const H = 3600_000;
const DAY = 24 * H;
/** Midnight UTC, so the arithmetic in the assertions stays readable. */
const T0 = Date.UTC(2026, 8, 7);

const rise = (d: number) => T0 + d * DAY + 6 * H;
const set = (d: number) => T0 + d * DAY + 18 * H;

describe('nightSpans', () => {
  it('returns the dark between a sunset and the next sunrise', () => {
    const spans = nightSpans([rise(0), rise(1)], [set(0)], set(0) - H, rise(1) + H);

    expect(spans).toEqual([{ from: set(0), to: rise(1), fadeIn: true, fadeOut: true }]);
  });

  it('closes a night that is still running when the window ends', () => {
    // Opening at midnight is already dark, so this is both ends of one day:
    // the tail of the night before and the head of the night after.
    const spans = nightSpans([rise(0)], [set(0)], T0, set(0) + 3 * H);

    expect(spans).toEqual([
      // The window opened mid-darkness, so its left edge is not a sunset and
      // its right edge is not a sunrise; neither gets a fade.
      { from: T0, to: rise(0), fadeIn: false, fadeOut: true },
      { from: set(0), to: set(0) + 3 * H, fadeIn: true, fadeOut: false },
    ]);
  });

  it('opens in the dark when the window starts after a sunset', () => {
    // Nothing before `from` says it is night except the sunset behind it.
    const spans = nightSpans([rise(1)], [set(0)], set(0) + 2 * H, rise(1) + H);

    expect(spans).toEqual([{ from: set(0) + 2 * H, to: rise(1), fadeIn: false, fadeOut: true }]);
  });

  it('opens in the dark when the window starts before every event', () => {
    // The first thing that happens is a sunrise, so it was night until then.
    const spans = nightSpans([rise(0)], [set(0)], rise(0) - 2 * H, set(0));

    expect(spans).toEqual([{ from: rise(0) - 2 * H, to: rise(0), fadeIn: false, fadeOut: true }]);
  });

  it('opens in daylight when the first thing that happens is a sunset', () => {
    const spans = nightSpans([rise(1)], [set(0)], set(0) - 2 * H, set(0) + H);

    expect(spans).toEqual([{ from: set(0), to: set(0) + H, fadeIn: true, fadeOut: false }]);
  });

  it('runs a week without losing or merging a night', () => {
    const rises = Array.from({ length: 7 }, (_, d) => rise(d));
    const sets = Array.from({ length: 7 }, (_, d) => set(d));

    const spans = nightSpans(rises, sets, rise(0), set(6));

    // Six full nights between seven days, none of them touching.
    expect(spans).toHaveLength(6);
    for (const s of spans) expect(s.to - s.from).toBe(12 * H);
  });

  it('shades nothing without sun times, rather than guessing', () => {
    expect(nightSpans([], [], T0, T0 + DAY)).toEqual([]);
  });

  it('shades nothing for an empty or inverted window', () => {
    expect(nightSpans([rise(0)], [set(0)], T0 + DAY, T0)).toEqual([]);
  });
});

describe('sunEvents', () => {
  const forecast = (daily: ForecastResponse['daily']) =>
    ({ daily }) as ForecastResponse;

  it('reads the local stamps against the spot offset', () => {
    const { sunrises, sunsets } = sunEvents(
      forecast({ time: ['2026-09-07'], sunrise: ['2026-09-07T06:14'], sunset: ['2026-09-07T17:39'] }),
      10 * 3600,
    );

    expect(new Date(sunrises[0]).toISOString()).toBe('2026-09-06T20:14:00.000Z');
    expect(new Date(sunsets[0]).toISOString()).toBe('2026-09-07T07:39:00.000Z');
  });

  it('drops a day the sun never crossed instead of inventing one', () => {
    const { sunrises, sunsets } = sunEvents(
      forecast({ time: ['2026-06-21'], sunrise: [null], sunset: [null] }),
      0,
    );

    expect(sunrises).toEqual([]);
    expect(sunsets).toEqual([]);
  });

  it('survives a response with no daily block at all', () => {
    expect(sunEvents(forecast(undefined), 0)).toEqual({ sunrises: [], sunsets: [] });
  });
});

describe('twilightMs', () => {
  const on = (date: string) => Date.parse(`${date}T12:00:00Z`);

  it('gives Sydney about twenty-five minutes at the equinox', () => {
    const minutes = twilightMs(-33.87, on('2026-09-23'))! / 60_000;

    expect(minutes).toBeGreaterThan(23);
    expect(minutes).toBeLessThan(27);
  });

  it('lengthens with latitude, which is the whole reason it is computed', () => {
    const at = (lat: number) => twilightMs(lat, on('2026-06-21'))!;

    // Midwinter in the south: Hobart's dusk runs longer than Sydney's, and
    // Sydney's longer than Darwin's.
    expect(at(-42.88)).toBeGreaterThan(at(-33.87));
    expect(at(-33.87)).toBeGreaterThan(at(-12.46));
  });

  it('is shortest at the equator, where the sun drops straight down', () => {
    const minutes = twilightMs(0, on('2026-03-21'))! / 60_000;

    expect(minutes).toBeGreaterThan(19);
    expect(minutes).toBeLessThan(22);
  });

  it('gives null under the midnight sun, rather than a number', () => {
    // Tromsø in June: the sun never reaches either altitude, so there is no
    // dusk to fade and the spine keeps its hard edge.
    expect(twilightMs(69.65, on('2026-06-21'))).toBeNull();
  });

  it('is symmetric about the equator on an equinox', () => {
    const north = twilightMs(40, on('2026-09-23'))!;
    const south = twilightMs(-40, on('2026-09-23'))!;

    expect(north).toBeCloseTo(south, -3);
  });
});
