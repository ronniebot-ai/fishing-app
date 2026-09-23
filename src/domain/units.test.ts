/**
 * Dates on somebody else's calendar.
 *
 * Every helper here takes the spot's own UTC offset rather than reading the
 * machine's clock, because the machine is usually in a different place from
 * the fishing spot and always is on a server. The tests say so by asserting
 * the same instant twice, under two offsets.
 */
import { describe, expect, it } from 'vitest';
import { epochToSpotDay, spotDaySpans } from './units';

describe('epochToSpotDay', () => {
  const SYD = 10 * 3600;
  /** 8 Sep 2026 is a Tuesday. Midnight in Sydney is 2pm UTC the day before. */
  const T = Date.UTC(2026, 8, 7, 14);

  it('names the day on the spot\'s calendar, not the browser\'s', () => {
    expect(epochToSpotDay(T, SYD)).toBe('Tue 8 Sep');
  });

  it('shortens on request, and never carries a year', () => {
    expect(epochToSpotDay(T, SYD, 'short')).toBe('Tue 8');
    expect(epochToSpotDay(T, SYD, 'weekday')).toBe('Tue');
    expect(epochToSpotDay(T, SYD, 'full')).not.toMatch(/2026/);
  });

  it('is a different day either side of the offset', () => {
    // The same instant is still Monday in UTC, which is the whole point of
    // passing the spot's offset rather than reading the local clock.
    expect(epochToSpotDay(T, 0)).toBe('Mon 7 Sep');
  });
});

describe('spotDaySpans', () => {
  const SYD = 10 * 3600;
  const midnight = Date.UTC(2026, 8, 7, 14); // 8 Sep 00:00 in Sydney
  const H = 3600_000;

  it('clips the first and last days to the range asked for', () => {
    const spans = spotDaySpans(midnight - 4 * H, midnight + 30 * H, SYD);

    expect(spans).toHaveLength(3);
    expect(spans[0].from).toBe(midnight - 4 * H);
    expect(spans[0].to).toBe(midnight);
    // Named by its own midnight even though the span starts hours into it.
    expect(epochToSpotDay(spans[0].t, SYD, 'weekday')).toBe('Mon');
    expect(spans[2].to).toBe(midnight + 30 * H);
  });

  it('covers the range end to end with no gaps or overlaps', () => {
    const from = midnight + 5 * H;
    const to = midnight + 170 * H;
    const spans = spotDaySpans(from, to, SYD);

    expect(spans[0].from).toBe(from);
    expect(spans.at(-1)!.to).toBe(to);
    for (let i = 1; i < spans.length; i++) expect(spans[i].from).toBe(spans[i - 1].to);
  });

  it('gives a week of days for a week-wide window', () => {
    expect(spotDaySpans(midnight, midnight + 168 * H, SYD)).toHaveLength(7);
  });

  it('returns nothing for an empty or inverted range', () => {
    expect(spotDaySpans(midnight, midnight, SYD)).toEqual([]);
    expect(spotDaySpans(midnight + H, midnight, SYD)).toEqual([]);
  });
});
