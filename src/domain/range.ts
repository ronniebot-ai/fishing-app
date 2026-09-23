/**
 * How much time the spine shows at once.
 *
 * `hours` is the whole visible span, not the part ahead of now. That reading
 * is forced by the scrubber: once the window can be dragged into the past,
 * "the next 72 hours" stops describing anything. The middle tier is 72 hours
 * because that is exactly what the chart drew before there was a choice —
 * a day back and two days forward — so picking the default changes nothing.
 */
export const RANGES = [
  { key: 'day', hours: 24, label: '1 day', roamHours: 0, windowLimit: 3 },
  { key: 'three', hours: 72, label: '3 days', roamHours: 60, windowLimit: 5 },
  { key: 'week', hours: 168, label: '1 week', roamHours: 168, windowLimit: 8 },
] as const;

export type RangeKey = (typeof RANGES)[number]['key'];

export const DEFAULT_RANGE: RangeKey = 'three';

/** Where `now` sits in the window before anybody drags it: a third along. */
export const NOW_AT = 1 / 3;

export function rangeFor(key: RangeKey): (typeof RANGES)[number] {
  return RANGES.find((r) => r.key === key)!;
}

export function rangeHours(key: RangeKey): number {
  return rangeFor(key).hours;
}

/**
 * How far past the opening window this range lets the reader travel.
 *
 * Not the whole forecast. Seven days are always held, so scrubbing a one-day
 * window across all of it would be a long drag through hours the reader chose
 * a one-day window to not be shown — at that point they want the week, and
 * there is a button for it. A day therefore does not travel at all, and three
 * days travel far enough to reach the end of the weekend rather than the end
 * of the data.
 */
export function rangeRoamHours(key: RangeKey): number {
  return rangeFor(key).roamHours;
}

/**
 * How many windows the tables list over this span.
 *
 * Three was the whole answer while the chart only ever drew two days. Over a
 * week it would mean picking three hours out of a hundred and sixty-eight and
 * calling the rest nothing, so the count grows with the span it is chosen
 * from — still a shortlist, just one proportionate to what was searched.
 */
export function rangeWindowLimit(key: RangeKey): number {
  return rangeFor(key).windowLimit;
}

/**
 * A stored range, or the default.
 *
 * Whatever is in `localStorage` is not ours: it can be hand-edited, left over
 * from a version that spelled the keys differently, or absent. Anything
 * unrecognised is the default rather than an error, because there is no
 * sensible way for the page to report one and nothing is lost by guessing.
 */
export function parseRange(value: string | null): RangeKey {
  return RANGES.some((r) => r.key === value) ? (value as RangeKey) : DEFAULT_RANGE;
}
