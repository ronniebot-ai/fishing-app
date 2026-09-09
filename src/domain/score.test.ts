import { describe, expect, it } from 'vitest';
import type { TimelinePoint } from '../api/types';
import { GATES, findBestWindows, piecewise, scoreHour } from './score';

const HOUR = 3600_000;

function point(overrides: Partial<TimelinePoint> = {}): TimelinePoint {
  return {
    time: '2026-09-07T06:00',
    t: Date.UTC(2026, 8, 7, 6),
    windSpeed: 8, windGust: 11, windDir: 180,
    precip: 0, precipProb: 5, temp: 18,
    waveHeight: 0.8, wavePeriod: 9, waveDir: 160,
    swellHeight: 0.7, swellPeriod: 10,
    tideHeight: 0.2, tideRate: 0.3,
    ...overrides,
  };
}

const factor = (r: ReturnType<typeof scoreHour>, key: string) =>
  r.factors.find((f) => f.key === key)!;

describe('piecewise', () => {
  const curve = [[0, 0], [10, 1], [20, 0]] as const;

  it('interpolates between breakpoints', () => {
    expect(piecewise(5, curve)).toBeCloseTo(0.5, 6);
    expect(piecewise(15, curve)).toBeCloseTo(0.5, 6);
  });

  it('hits breakpoints exactly', () => {
    expect(piecewise(10, curve)).toBe(1);
  });

  it('clamps outside the range instead of extrapolating', () => {
    expect(piecewise(-100, curve)).toBe(0);
    expect(piecewise(999, curve)).toBe(0);
  });
});

describe('scoreHour', () => {
  it('rates a calm running-tide morning highly', () => {
    const r = scoreHour(point());
    expect(r.score).toBeGreaterThan(75);
    expect(r.unfishable).toBe(false);
    expect(r.partial).toBe(false);
  });

  it('marks slack water down even when everything else is perfect', () => {
    const running = scoreHour(point({ tideRate: 0.3 })).score;
    const slack = scoreHour(point({ tideRate: 0 })).score;
    expect(slack).toBeLessThan(running);
  });

  it('lets one terrible factor sink the composite', () => {
    // The geometric mean is the point of the design: a gale must not be
    // averaged away by a perfect tide, swell and dry sky.
    const r = scoreHour(point({ windSpeed: 28, windGust: 35 }));
    expect(r.score).toBeLessThan(40);
  });

  it('caps the score when the wind gate trips', () => {
    const r = scoreHour(point({ windSpeed: GATES.windMaxKn + 5 }));
    expect(r.unfishable).toBe(true);
    expect(r.gateReason).toMatch(/wind/i);
    expect(r.score).toBeLessThanOrEqual(GATES.cappedScore);
  });

  it('caps the score when the swell gate trips', () => {
    const r = scoreHour(point({ waveHeight: GATES.waveMaxM + 1 }));
    expect(r.unfishable).toBe(true);
    expect(r.gateReason).toMatch(/swell/i);
    expect(r.score).toBeLessThanOrEqual(GATES.cappedScore);
  });

  it('prefers light drizzle over a downpour', () => {
    const drizzle = scoreHour(point({ precip: 0.2 })).score;
    const downpour = scoreHour(point({ precip: 10 })).score;
    expect(drizzle).toBeGreaterThan(downpour);
  });

  it('penalises a dead-flat sea relative to a workable swell', () => {
    const flat = factor(scoreHour(point({ waveHeight: 0 })), 'wave').value!;
    const workable = factor(scoreHour(point({ waveHeight: 0.8 })), 'wave').value!;
    expect(flat).toBeLessThan(workable);
  });

  it('still scores on wind and rain alone when marine data is missing', () => {
    const r = scoreHour(point({
      waveHeight: null, wavePeriod: null, swellHeight: null,
      tideHeight: null, tideRate: null,
    }));
    expect(r.partial).toBe(true);
    expect(r.score).toBeGreaterThan(0);
    expect(factor(r, 'tide').value).toBeNull();
    expect(factor(r, 'wave').value).toBeNull();
    expect(factor(r, 'wind').value).not.toBeNull();
  });

  it('describes the tide direction in the breakdown', () => {
    expect(factor(scoreHour(point({ tideRate: 0.3 })), 'tide').detail).toMatch(/rising/i);
    expect(factor(scoreHour(point({ tideRate: -0.3 })), 'tide').detail).toMatch(/falling/i);
    expect(factor(scoreHour(point({ tideRate: 0 })), 'tide').detail).toMatch(/slack/i);
  });

  it('reports wind direction as a compass point', () => {
    expect(factor(scoreHour(point({ windDir: 90 })), 'wind').detail).toMatch(/^E /);
  });
});

describe('findBestWindows', () => {
  /** Build a run of hours starting now, alternating good and poor conditions. */
  function series(specs: Partial<TimelinePoint>[]): TimelinePoint[] {
    const start = Date.now();
    return specs.map((s, i) => point({ t: start + i * HOUR, ...s }));
  }

  it('groups contiguous good hours into a window', () => {
    const windows = findBestWindows(
      series([
        {}, {}, {},                                    // good
        { windSpeed: 32 }, { windSpeed: 32 },          // gated out
        {}, {},                                        // good again
      ]),
      [],
    );
    expect(windows.length).toBe(2);
    for (const w of windows) expect(w.endT).toBeGreaterThan(w.startT);
  });

  it('drops isolated single hours as not worth a trip', () => {
    const windows = findBestWindows(
      series([{}, { windSpeed: 32 }, {}, { windSpeed: 32 }]),
      [],
    );
    expect(windows).toEqual([]);
  });

  it('returns the strongest windows first, limited as asked', () => {
    const windows = findBestWindows(
      series([
        { windSpeed: 20 }, { windSpeed: 20 },  // fair
        { windSpeed: 32 },                     // break
        {}, {},                                // prime
      ]),
      [],
      { limit: 1 },
    );
    expect(windows.length).toBe(1);
    expect(windows[0].score).toBeGreaterThan(70);
  });

  it('ignores hours outside the horizon', () => {
    const far = point({ t: Date.now() + 200 * HOUR });
    expect(findBestWindows([far, far], [], { horizonHours: 48 })).toEqual([]);
  });
});
