import { describe, expect, it } from 'vitest';
import type { TimelinePoint } from '../api/types';
import type { TideExtreme } from './tides';
import { extremes, timeline } from '../fixtures/conditions';
import {
  DAYLIGHT_CAP, DEAD_OF_NIGHT, GATES, findBestWindows, piecewise, scoreHour, scoreRuns,
} from './score';

const HOUR = 3600_000;

function point(overrides: Partial<TimelinePoint> = {}): TimelinePoint {
  return {
    time: '2026-09-07T06:00',
    t: Date.UTC(2026, 8, 7, 6),
    windSpeed: 8, windGust: 11, windDir: 180,
    precip: 0, precipProb: 5, cloudCover: 40, temp: 18,
    waveHeight: 0.8, wavePeriod: 9, waveDir: 160,
    swellHeight: 0.95, swellPeriod: 10, swellDir: 140,
    tideHeight: 0.2, tideRate: 0.3,
    ...overrides,
  };
}

const factor = (r: ReturnType<typeof scoreHour>, key: string) =>
  r.factors.find((f) => f.key === key)!;

/**
 * Tide turns placed so the default hour sits `phase` of the way through a
 * six-hour run. The tide factor reads position between turns now, not rate,
 * so a score with no extremes behind it has no tide at all.
 */
function tideAt(phase: number, rising = true): TideExtreme[] {
  const span = 6 * HOUR;
  // A chain rather than a pair, so that phase 0 and phase 1 both land on a
  // turn with a run on either side of it — otherwise the two ends of the
  // curve are not comparable, one of them having no next turn to measure to.
  const first = point().t - (phase + 1) * span;
  return [0, 1, 2, 3].map((i) => {
    const low = rising === (i % 2 === 0);
    return { kind: low ? ('low' as const) : ('high' as const), t: first + i * span, height: low ? -0.5 : 0.6 };
  });
}

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
  it('rates a calm morning a third into the tide highly', () => {
    const r = scoreHour(point(), tideAt(1 / 3));
    expect(r.score).toBeGreaterThan(75);
    expect(r.unfishable).toBe(false);
    expect(r.partial).toBe(false);
  });

  it('puts the thirds above the middle of the run, and both above slack', () => {
    const at = (phase: number) => scoreHour(point(), tideAt(phase)).score;

    // The shape the whole factor exists to draw: two peaks a third in from
    // each end, a dip between them, and the turns themselves worst of all.
    expect(at(1 / 3)).toBeGreaterThan(at(0.5));
    expect(at(2 / 3)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(0));
    expect(at(0)).toBe(at(1));
    expect(at(1 / 3)).toBe(at(2 / 3));
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
    const flat = factor(scoreHour(point({ swellHeight: 0 })), 'wave').value!;
    const workable = factor(scoreHour(point({ swellHeight: 0.95 })), 'wave').value!;
    expect(flat).toBeLessThan(workable);
  });

  it('reads the swell against where it is coming from', () => {
    const swell = (height: number, dir: number) =>
      factor(scoreHour(point({ swellHeight: height, swellDir: dir })), 'wave').value!;

    // An easterly runs straight in, so small is what it wants; a southerly
    // arrives at an angle and needs some size behind it. The same half metre
    // is the best of one and the middling of the other.
    expect(swell(0.5, 90)).toBeGreaterThan(swell(0.5, 180));
    expect(swell(1.3, 90)).toBeLessThan(0.3);
    expect(swell(0.95, 180)).toBeGreaterThan(swell(1.3, 180));
  });

  it('gives a westerly the middle of the scale whatever its height', () => {
    // Offshore here: the water in close is flat and the number says nothing.
    const west = (h: number) => factor(scoreHour(point({ swellHeight: h, swellDir: 270 })), 'wave').value!;

    expect(west(0.2)).toBe(west(2.5));
    expect(west(0.2)).toBeGreaterThan(0.4);
    expect(west(0.2)).toBeLessThan(0.7);
  });

  it('rates overcast above hard sun, and rain below both', () => {
    const weather = (over: Partial<TimelinePoint>) =>
      factor(scoreHour(point(over)), 'weather').value!;

    expect(weather({ cloudCover: 80 })).toBeGreaterThan(weather({ cloudCover: 5 }));
    expect(weather({ cloudCover: 80, precip: 2 })).toBeLessThan(weather({ cloudCover: 5 }));
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

  it('describes the run and where in it the hour falls', () => {
    const detail = (phase: number, rate: number) =>
      factor(scoreHour(point({ tideRate: rate }), tideAt(phase, rate > 0)), 'tide').detail;

    expect(detail(0.2, 0.3)).toMatch(/rising, first third/i);
    expect(detail(0.8, -0.3)).toMatch(/falling, last third/i);
    expect(detail(0.5, 0.3)).toMatch(/middle/i);
  });

  it('has no tide factor at all without turns to place the hour between', () => {
    expect(factor(scoreHour(point()), 'tide').value).toBeNull();
  });

  it('reports wind direction as a compass point', () => {
    expect(factor(scoreHour(point({ windDir: 90 })), 'wind').detail).toMatch(/^E /);
  });
});

describe('wind direction', () => {
  const dirScore = (deg: number) => scoreHour(point({ windDir: deg }), tideAt(1 / 3)).score;
  const dirValue = (deg: number) => factor(scoreHour(point({ windDir: deg })), 'windDir').value!;

  it('puts a westerly above the coast-parallel winds, and an easterly below', () => {
    expect(dirValue(270)).toBeGreaterThan(dirValue(180));
    expect(dirValue(180)).toBeGreaterThan(dirValue(90));
    expect(dirValue(0)).toBe(dirValue(180));
  });

  it('moves the composite by a few points, not by a band', () => {
    // The whole span from best direction to worst, with nothing else changed.
    const spread = dirScore(270) - dirScore(90);

    expect(spread).toBeGreaterThan(0);
    expect(spread).toBeLessThan(8);
  });

  it('never drives the limiting term, however poor the direction', () => {
    // An easterly sits at 0.45. If it counted towards the worst-factor scaling
    // it would hold the composite under ~75 by itself, which is what a gale
    // does — the opposite of carrying it at a small weight.
    expect(dirScore(90)).toBeGreaterThan(80);
  });

  it('has no direction factor when the wind reading is missing', () => {
    expect(factor(scoreHour(point({ windDir: null })), 'windDir').value).toBeNull();
  });

  it('names the shore effect rather than just the bearing', () => {
    expect(factor(scoreHour(point({ windDir: 270 })), 'windDir').detail).toMatch(/offshore/);
    expect(factor(scoreHour(point({ windDir: 90 })), 'windDir').detail).toMatch(/onshore/);
  });
});

describe('the small hours', () => {
  /** The same hour of conditions, moved around the spot's own clock. */
  const at = (h: number, light: { from: number; to: number }[] = []) =>
    scoreHour(
      point({ time: `2026-09-07T${String(h).padStart(2, '0')}:00` }),
      tideAt(1 / 3),
      light,
    );

  it('docks midnight to four, and leaves the rest of the night alone', () => {
    const four = at(4).score;

    for (const h of [0, 1, 2, 3]) {
      expect(at(h).deadOfNight).toBe(true);
      expect(at(h).score).toBe(four - DEAD_OF_NIGHT.penalty);
    }
    expect(at(4).deadOfNight).toBe(false);
    expect(at(23).deadOfNight).toBe(false);
    expect(at(23).score).toBe(four);
  });

  it('subtracts rather than caps, so a good night still beats a bad one', () => {
    const calm = at(2).score;
    const blowy = scoreHour(
      point({ time: '2026-09-07T02:00', windSpeed: 18 }),
      tideAt(1 / 3),
    ).score;

    expect(calm).toBeGreaterThan(blowy);
  });

  it('comes off after the off-peak cap, not before it', () => {
    // 2am is never within the change of light, so both apply and the penalty
    // is taken from the capped figure rather than from the raw blend.
    const away = [{ from: point().t + 20 * HOUR, to: point().t + 22 * HOUR }];

    expect(at(2, away).score).toBe(DAYLIGHT_CAP - DEAD_OF_NIGHT.penalty);
  });

  it('cannot push a gated hour below zero', () => {
    const r = scoreHour(
      point({ time: '2026-09-07T02:00', windSpeed: GATES.windMaxKn + 20 }),
      tideAt(1 / 3),
    );

    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});

describe('the change of light', () => {
  const T = point().t;
  const dawn = [{ from: T - HOUR, to: T + HOUR }];
  const away = [{ from: T + 6 * HOUR, to: T + 8 * HOUR }];

  it('lets an hour inside the window reach Prime', () => {
    const r = scoreHour(point(), tideAt(1 / 3), dawn);

    expect(r.offPeak).toBe(false);
    expect(r.score).toBeGreaterThan(DAYLIGHT_CAP);
  });

  it('holds an identical hour outside it to Good', () => {
    const r = scoreHour(point(), tideAt(1 / 3), away);

    // Same conditions, same factors — only the light is different.
    expect(r.offPeak).toBe(true);
    expect(r.score).toBe(DAYLIGHT_CAP);
    expect(factor(r, 'tide').value).toBe(factor(scoreHour(point(), tideAt(1 / 3), dawn), 'tide').value);
  });

  it('leaves an already-poor hour alone, since the cap is a ceiling', () => {
    const blown = scoreHour(point({ windSpeed: 28, windGust: 35 }), tideAt(1 / 3), away);

    expect(blown.score).toBeLessThan(DAYLIGHT_CAP);
  });

  it('does not cap at all when the sun times were never fetched', () => {
    // An empty list means "unknown", not "never dawn". Marking the whole week
    // down because a request failed would be the worst kind of quiet wrong.
    const r = scoreHour(point(), tideAt(1 / 3), []);

    expect(r.offPeak).toBe(false);
    expect(r.score).toBeGreaterThan(DAYLIGHT_CAP);
  });

  it('keeps the gate below the cap when both apply', () => {
    const r = scoreHour(point({ windSpeed: GATES.windMaxKn + 5 }), tideAt(1 / 3), away);

    expect(r.unfishable).toBe(true);
    expect(r.score).toBeLessThanOrEqual(GATES.cappedScore);
  });

  it('carries the cap through to the windows the tables list', () => {
    const start = point().t;
    const hours = [0, 1, 2, 3].map((i) => point({ t: start + i * HOUR }));

    const lit = findBestWindows(hours, tideAt(1 / 3), { now: start, light: [{ from: start, to: start + 4 * HOUR }] });
    const dark = findBestWindows(hours, tideAt(1 / 3), { now: start, light: away });

    expect(dark[0].score).toBeLessThan(lit[0].score);
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
        { cloudCover: 5 }, { cloudCover: 5 },  // fair: hard sun
        { windSpeed: 32 },                     // break: gated out
        {}, {},                                // better: overcast
      ]),
      [],
      { limit: 1 },
    );
    expect(windows.length).toBe(1);
    // The overcast pair, not the glary one. Both clear the threshold, so this
    // compares the two rather than asserting a mark the curves could drift past.
    expect(windows[0].score).toBeGreaterThan(
      findBestWindows(series([{ cloudCover: 5 }, { cloudCover: 5 }]), [])[0].score,
    );
  });

  it('ignores hours outside the horizon', () => {
    const far = point({ t: Date.now() + 200 * HOUR });
    expect(findBestWindows([far, far], [], { horizonHours: 48 })).toEqual([]);
  });
});

describe('scoreRuns', () => {
  it('merges neighbouring hours that share a band into one run', () => {
    const runs = scoreRuns(timeline, extremes);

    // Never one run per hour: the score moves slowly, so the bands are few.
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.length).toBeLessThan(timeline.length);
    for (const run of runs) expect(run.to).toBeGreaterThan(run.from);
  });

  it('leaves poor hours unmarked rather than giving them a colour', () => {
    const tones = scoreRuns(timeline, extremes).map((r) => r.tone as string);

    expect(tones).not.toContain('poor');
  });

  it('marks nothing at all when every hour is poor', () => {
    // A gale: every hour trips the wind gate, which caps the score at 20.
    const blown = timeline.map((p) => ({ ...p, windSpeed: 44, windGust: 58 }));

    expect(scoreRuns(blown, extremes)).toEqual([]);
  });

  it('breaks a run where the timeline has a hole, rather than painting over it', () => {
    const holed = [...timeline.slice(0, 6), ...timeline.slice(12)];

    for (const run of scoreRuns(holed, extremes)) {
      const covered = holed.filter((p) => p.t >= run.from && p.t < run.to);
      // Every hour a run claims has to be an hour that is actually there.
      expect(covered).toHaveLength((run.to - run.from) / HOUR);
    }
  });

  it('runs to the end of the last hour, not to its start', () => {
    const one = scoreRuns([timeline[15]], extremes);

    expect(one).toHaveLength(1);
    expect(one[0].from).toBe(timeline[15].t);
    expect(one[0].to - one[0].from).toBe(HOUR);
  });
});
