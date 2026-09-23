/**
 * The ranges themselves are data, so the only thing with behaviour is the
 * parser — and everything it reads comes out of `localStorage`, which belongs
 * to the browser rather than to us.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RANGE, parseRange, RANGES, rangeHours, rangeRoamHours } from './range';

describe('parseRange', () => {
  it('accepts every key it offers', () => {
    for (const r of RANGES) expect(parseRange(r.key)).toBe(r.key);
  });

  it.each([null, '', 'week ', 'WEEK', 'fortnight', '72', '[object Object]'])(
    'falls back to the default for %o',
    (stored) => {
      expect(parseRange(stored)).toBe(DEFAULT_RANGE);
    },
  );
});

describe('the ranges', () => {
  it('opens on the span the chart drew before there was a choice', () => {
    // A day back and two days forward. Keeping the middle tier at 72 is what
    // makes the new default invisible to everyone already using the app.
    expect(rangeHours(DEFAULT_RANGE)).toBe(72);
  });

  it('runs shortest to longest, so the buttons read in order', () => {
    const hours = RANGES.map((r) => r.hours);

    expect(hours).toEqual([...hours].sort((a, b) => a - b));
  });
});

describe('rangeRoamHours', () => {
  it('leaves a day nowhere to travel, so it needs no bar at all', () => {
    expect(rangeRoamHours('day')).toBe(0);
  });

  it('gives three days about half the travel the whole forecast would', () => {
    // 192 hours are held, so an unbounded three-day window would scrub across
    // roughly 120. Halving it keeps the drag proportionate to the choice.
    expect(rangeRoamHours('three')).toBeCloseTo((192 - 72) / 2, -1);
  });

  it('lets the week reach the end of what was fetched', () => {
    expect(rangeHours('week') + rangeRoamHours('week')).toBeGreaterThanOrEqual(192);
  });
});
