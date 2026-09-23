/**
 * What the assistant is given to answer from.
 *
 * Two things matter here and nothing else really does. The context has to say
 * what the page says — a number that disagrees with the screen is worse than
 * no answer at all — and it has to be a pure function of its input, because it
 * is the cached half of every prompt and one changing byte costs the cache.
 */
import { describe, expect, it } from 'vitest';
import type { TimelinePoint } from '../api/types';
import {
  NOW, SYDNEY_UTC_OFFSET, extremes, inlandPoint, light, nowPoint, timeline, windows,
} from '../fixtures/conditions';
import { buildChatContext, type ChatContextInput } from './chatContext';
import { scoreHour } from './score';

const SPOT = { lat: -33.8908, lon: 151.2743 };

function context(over: Partial<ChatContextInput> = {}): string {
  return buildChatContext({
    spot: SPOT,
    spotName: null,
    timeline,
    extremes,
    windows,
    light,
    snap: { anchor: { lat: -33.89, lon: 151.29 }, distanceKm: 1.8 },
    utcOffsetSeconds: SYDNEY_UTC_OFFSET,
    timezone: 'Australia/Sydney',
    now: NOW,
    ...over,
  });
}

describe('buildChatContext', () => {
  it('opens with the spot, its zone and where it is', () => {
    const text = context();

    expect(text).toMatch(/33\.8908°S 151\.2743°E/);
    expect(text).toMatch(/Australia\/Sydney \(UTC\+10:00\)/);
  });

  it('gives the saved name when the spot has one', () => {
    expect(context({ spotName: 'The wall' })).toMatch(/Saved as: The wall/);
    expect(context()).not.toMatch(/Saved as/);
  });

  it('carries the same score the page is showing', () => {
    const { score } = scoreHour(nowPoint, extremes);

    expect(context()).toMatch(new RegExp(`Score ${score}/100`));
  });

  it('breaks the score into the factors that made it', () => {
    const text = context();

    // The details are the scorer's own words, so an explanation cannot drift
    // from the reason.
    for (const factor of scoreHour(nowPoint, extremes).factors) {
      expect(text).toContain(factor.detail);
    }
  });

  it('gives every hour from now to the end of the horizon, one to a line', () => {
    const text = context();
    const hours = text
      .split('\n')
      .filter((line) => / \| score \d/.test(line));

    // The fixture is a single day, so the horizon runs out before the list
    // does: what should appear is the current hour and everything after it.
    expect(hours).toHaveLength(timeline.filter((p) => p.t >= NOW).length);
    expect(hours[0]).toMatch(/^Mon 7 Sep 3pm \|/);
    expect(hours[0]).toMatch(/wind SSE 7 kn, gusting 13/);
    expect(hours[0]).toMatch(/tide \+0\.83 m, rising 0\.18 m\/hr/);
  });

  it('names the tide turns still ahead, and leaves out the ones gone by', () => {
    const text = context();
    const turns = text.slice(text.indexOf('TIDE TURNS'));

    const ahead = extremes.filter((e) => e.t >= NOW);
    expect(ahead.length).toBeGreaterThan(0);
    for (const turn of ahead) {
      // Dated, not just clocked: a bare "4:30pm" two days out reads as today.
      expect(turns).toMatch(turn.kind === 'high' ? /High \w{3} \d+ \d/ : /Low \w{3} \d+ \d/);
    }
    expect(turns.split('\n').filter((l) => /^(High|Low) /.test(l))).toHaveLength(ahead.length);
  });

  it('lists the windows the app picked rather than inviting a second opinion', () => {
    const text = context();

    expect(text).toMatch(/BEST WINDOWS/);
    expect(text).toMatch(new RegExp(`averaging ${windows[0].score}/100`));
  });

  it('leaves out a window the hourly readings do not reach, and says it did', () => {
    // The chart can be set to search a week; this block only ever carries two
    // days. A window quoted without the hours behind it is a score the
    // assistant cannot explain and will date wrongly.
    const far = { startT: NOW + 120 * 3600_000, endT: NOW + 123 * 3600_000, score: 91, peakT: NOW + 121 * 3600_000 };
    const text = context({ windows: [...windows, far] });

    expect(text).not.toMatch(/averaging 91\/100/);
    expect(text).toMatch(/1 more beyond the 48 hours/);
  });

  it('says nothing about extras when every window is inside the horizon', () => {
    expect(context()).not.toMatch(/more beyond/);
  });

  it('says when the marine figures were measured somewhere else', () => {
    const text = context({ snap: { anchor: { lat: -33.7, lon: 151.6 }, distanceKm: 31.4 } });

    expect(text).toMatch(/measured 31 km away/);
  });

  it('says outright when there is no marine data at all', () => {
    const inland: TimelinePoint[] = timeline.map((p) => ({
      ...p,
      waveHeight: null, wavePeriod: null, waveDir: null,
      swellHeight: null, swellPeriod: null, tideHeight: null, tideRate: null,
    }));
    const text = context({
      timeline: inland,
      extremes: [],
      windows: [],
      snap: { anchor: null, distanceKm: Infinity },
    });

    expect(text).toMatch(/No marine data/);
    expect(text).toMatch(/None in range/);
    // The factor list still says the swell is missing — that is worth
    // knowing — but no hourly line carries a figure for it, because an
    // absent field is left out rather than written as a placeholder.
    expect(text).toMatch(/Swell: no data/);
    for (const line of text.split('\n').filter((l) => / \| score \d/.test(l))) {
      expect(line).not.toMatch(/swell|tide/);
    }
  });

  it('holds still for the same input, so the cached prefix stays cached', () => {
    expect(context()).toBe(context());
  });

  it('does not move minute to minute', () => {
    // The clock ticks every minute while the page is open, and the prompt is
    // paid for again whenever it changes. The readings are hourly, so a
    // minute passing is not a reason for any of this to be rewritten.
    const tenPast = context({ now: NOW + 10 * 60_000 });

    expect(context({ now: NOW + 11 * 60_000 })).toBe(tenPast);
    expect(context({ now: NOW + 25 * 60_000 })).toBe(tenPast);
  });

  it('skips the current reading rather than inventing one when the hour is gone', () => {
    const text = context({ now: timeline[timeline.length - 1].t + 4 * 3600_000 });

    expect(text).not.toMatch(/\nNOW\n/);
    expect(text).toMatch(/SPOT/);
  });

  it('stays well inside the size the server will accept', () => {
    // 24000 characters is the server's limit; two days of hourly readings is
    // twice this fixture's single day.
    expect(context().length * 2).toBeLessThan(24000);
  });

  it('reports a tripped gate as the override it is', () => {
    const blown = timeline.map((p) => ({ ...p, windSpeed: 42, windGust: 58 }));

    expect(context({ timeline: blown })).toMatch(/Unfishable: Wind over 30 kn/);
  });

  it('is unbothered by an hour with nothing in it', () => {
    expect(() => context({ timeline: [{ ...inlandPoint, t: NOW }], extremes: [] })).not.toThrow();
  });
});
