import { describe, expect, it } from 'vitest';
import type { TimelinePoint } from '../api/types';
import { deriveTideRates, findTideExtremes, hoursToNearestTurn } from './tides';

/**
 * Real hourly sea levels pulled from the Open-Meteo marine endpoint for
 * Sydney (-33.85, 151.30) on 2026-09-07. Two highs and one low fall inside
 * the window, so this exercises the interpolation on genuine model output
 * rather than a synthetic sine wave.
 */
const SYDNEY_TIDE = [
  -0.29, -0.12, 0.08, 0.25, 0.34, 0.33, 0.22, 0.07,
  -0.1, -0.21, -0.24, -0.15, 0.04, 0.3, 0.59, 0.83,
  0.96, 0.96, 0.79, 0.54, 0.23, -0.07, -0.3, -0.42,
];

const HOUR = 3600_000;
const BASE = Date.UTC(2026, 8, 7, 0, 0, 0);

function timeline(heights: (number | null)[]): TimelinePoint[] {
  return heights.map((h, i) => ({
    time: `2026-09-07T${String(i).padStart(2, '0')}:00`,
    t: BASE + i * HOUR,
    windSpeed: null, windGust: null, windDir: null,
    precip: null, precipProb: null, temp: null,
    waveHeight: null, wavePeriod: null, waveDir: null,
    swellHeight: null, swellPeriod: null,
    tideHeight: h,
    tideRate: null,
  }));
}

/** Hours since midnight for an extreme, for readable assertions. */
const hourOf = (t: number) => (t - BASE) / HOUR;

describe('deriveTideRates', () => {
  it('uses a central difference for interior points', () => {
    const rates = deriveTideRates([0, 1, 2, 3]);
    // (2 - 0) / 2 = 1
    expect(rates[1]).toBeCloseTo(1, 6);
    expect(rates[2]).toBeCloseTo(1, 6);
  });

  it('falls back to one-sided differences at the edges', () => {
    const rates = deriveTideRates([0, 1, 3]);
    expect(rates[0]).toBeCloseTo(1, 6); // forward: 1 - 0
    expect(rates[2]).toBeCloseTo(2, 6); // backward: 3 - 1
  });

  it('signs a rising tide positive and a falling tide negative', () => {
    const rates = deriveTideRates(SYDNEY_TIDE);
    expect(rates[2]!).toBeGreaterThan(0); // climbing toward the 4am high
    expect(rates[7]!).toBeLessThan(0); // ebbing toward the 10am low
  });

  it('returns null where the series has gaps', () => {
    const rates = deriveTideRates([0, null, 2, 3]);
    expect(rates[1]).toBeNull();
    // Neighbour is null, so it degrades to a one-sided difference.
    expect(rates[2]).toBeCloseTo(1, 6);
  });
});

describe('findTideExtremes', () => {
  const extremes = findTideExtremes(timeline(SYDNEY_TIDE));

  it('finds every turn in the day, alternating high and low', () => {
    expect(extremes.map((e) => e.kind)).toEqual(['high', 'low', 'high']);
  });

  it('places the turns near the right hours', () => {
    expect(hourOf(extremes[0].t)).toBeGreaterThan(3.5);
    expect(hourOf(extremes[0].t)).toBeLessThan(5);
    expect(hourOf(extremes[1].t)).toBeGreaterThan(9.5);
    expect(hourOf(extremes[1].t)).toBeLessThan(11);
    expect(hourOf(extremes[2].t)).toBeGreaterThan(16);
    expect(hourOf(extremes[2].t)).toBeLessThan(17.5);
  });

  it('resolves turns off the hour, not quantised to it', () => {
    // The 16:00 and 17:00 samples are tied at 0.96, so the true high sits
    // between them. A naive local-maximum scan would report exactly 16:00.
    const offsetFromHour = Math.abs(hourOf(extremes[2].t) - 16);
    expect(offsetFromHour).toBeGreaterThan(0.1);
  });

  it('interpolates a high at or above its neighbouring samples', () => {
    expect(extremes[0].height).toBeGreaterThanOrEqual(0.34);
    expect(extremes[2].height).toBeGreaterThanOrEqual(0.96);
  });

  it('interpolates a low at or below its neighbouring samples', () => {
    expect(extremes[1].height).toBeLessThanOrEqual(-0.24);
  });

  it('ignores a perfectly flat series', () => {
    expect(findTideExtremes(timeline([1, 1, 1, 1, 1]))).toEqual([]);
  });

  it('skips hours with no tide data', () => {
    expect(findTideExtremes(timeline([0, null, 1, null, 0]))).toEqual([]);
  });
});

describe('hoursToNearestTurn', () => {
  const extremes = findTideExtremes(timeline(SYDNEY_TIDE));

  it('measures to the closest turn in either direction', () => {
    // 07:00 sits between the ~4am high and the ~10am low.
    const gap = hoursToNearestTurn(extremes, BASE + 7 * HOUR)!;
    expect(gap).toBeGreaterThan(2);
    expect(gap).toBeLessThan(3.5);
  });

  it('returns null when no turns are known', () => {
    expect(hoursToNearestTurn([], BASE)).toBeNull();
  });
});
