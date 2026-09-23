/**
 * What gets kept, and what deliberately does not.
 *
 * The rules that matter here are all about not storing something misleading:
 * the past, an hour the model left blank, or a score assembled from half a
 * reading.
 */
import { describe, expect, it } from 'vitest';
import { extremes, timeline } from '../fixtures/conditions';
import { scoreHour } from './score';
import { snapshotHours, SNAPSHOT_HOURS } from './snapshots';

const START = timeline[0].t;

describe('snapshotHours', () => {
  it('keeps the hours from now forward and leaves the past alone', () => {
    const from = timeline[10].t;
    const kept = snapshotHours(timeline, extremes, from);

    expect(kept.length).toBeGreaterThan(0);
    for (const hour of kept) {
      expect(Date.parse(hour.at)).toBeGreaterThanOrEqual(from);
    }
  });

  it('stops at the horizon it was given', () => {
    expect(snapshotHours(timeline, extremes, START, 5)).toHaveLength(5);
  });

  it('defaults to two days, which is what the page draws', () => {
    expect(SNAPSHOT_HOURS).toBe(48);
  });

  it('records the instant, not the wall clock', () => {
    // `t` is already a real instant — the timeline subtracts the spot's offset
    // when it parses the model's stamps — so the ISO string round-trips.
    const [first] = snapshotHours(timeline, extremes, START, 1);
    expect(Date.parse(first.at)).toBe(timeline[0].t);
  });

  it('carries the same score the page would draw for that hour', () => {
    const [first] = snapshotHours(timeline, extremes, START, 1);
    const drawn = scoreHour(timeline[0], extremes);

    expect(first.score).toBe(drawn.score);
    expect(first.unfishable).toBe(drawn.unfishable);
  });

  it('carries every factor the score was built from', () => {
    const [first] = snapshotHours(timeline, extremes, START, 1);
    expect(Object.keys(first.factors).sort()).toEqual(['tide', 'wave', 'weather', 'wind', 'windDir']);
  });

  it('carries the readings behind the score, not just the score', () => {
    const [first] = snapshotHours(timeline, extremes, START, 1);

    expect(first).toMatchObject({
      windKn: timeline[0].windSpeed,
      gustKn: timeline[0].windGust,
      waveM: timeline[0].waveHeight,
      rainMm: timeline[0].precip,
    });
  });

  it('skips an hour scored from an incomplete reading', () => {
    // A partial score is honest enough to show with a caveat next to it, but
    // averaging over it later would quietly mix two different measurements.
    const holed = timeline.map((point, i) =>
      i === 0 ? { ...point, waveHeight: null, tideHeight: null, tideRate: null } : point,
    );

    const kept = snapshotHours(holed, extremes, START, 3);
    expect(Date.parse(kept[0].at)).toBe(timeline[1].t);
  });

  it('returns nothing rather than throwing when the forecast has run out', () => {
    const past = timeline[timeline.length - 1].t + 3_600_000;
    expect(snapshotHours(timeline, extremes, past)).toEqual([]);
  });

  it('returns nothing for an empty timeline', () => {
    expect(snapshotHours([], [], START)).toEqual([]);
  });
});
