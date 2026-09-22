import type { LatLon } from '../api/types';

/**
 * Read a spot out of URL query values.
 *
 * Two callers need the same answer and must not disagree: the server component
 * that renders a shared link, and the `popstate` handler that reacts to Back.
 * Keeping the rule here rather than in either of them is what makes a link and
 * a history entry resolve to the same place.
 *
 * Values arrive as `string | string[]` from Next's `searchParams` and as
 * `string | null` from `URLSearchParams.get`, so both shapes are accepted.
 */
export function parseSpot(
  lat: string | string[] | null | undefined,
  lon: string | string[] | null | undefined,
): LatLon | null {
  const latText = firstValue(lat);
  const lonText = firstValue(lon);
  if (latText === null || lonText === null) return null;

  const latNum = Number(latText);
  const lonNum = Number(lonText);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return null;

  // The same bounds the API enforces. A URL is user input too.
  if (Math.abs(latNum) > 90 || Math.abs(lonNum) > 180) return null;

  return { lat: latNum, lon: lonNum };
}

/**
 * `?lat=1&lat=2` is legal and reaches us as an array; take the first, which is
 * what `URLSearchParams.get` would have returned.
 *
 * Blank counts as absent. `Number('')` is 0, so without this `?lat=&lon=`
 * would resolve to a point in the Atlantic rather than to no spot at all.
 */
function firstValue(value: string | string[] | null | undefined): string | null {
  const text = Array.isArray(value) ? value[0] : value;
  if (text === undefined || text === null) return null;
  return text.trim() === '' ? null : text;
}
