/**
 * The bounds a shared link has to clear.
 *
 * These rules were always in the app, inside the function that read
 * `window.location`, and so could never be called directly. Pulling them out
 * for the server component is what made them testable — and the server is now
 * the first thing a stranger's URL reaches, which is a better reason to pin
 * them down than they had before.
 */
import { describe, expect, it } from 'vitest';
import { parseSpot } from './spotUrl';

const BONDI = { lat: -33.8908, lon: 151.2743 };

describe('parseSpot', () => {
  it('reads a coordinate pair', () => {
    expect(parseSpot('-33.8908', '151.2743')).toEqual(BONDI);
  });

  it('takes the first of a repeated parameter, as URLSearchParams would', () => {
    expect(parseSpot(['-33.8908', '0'], ['151.2743', '0'])).toEqual(BONDI);
  });

  it.each([
    ['a missing latitude', undefined, '151.2743'],
    ['a missing longitude', '-33.8908', undefined],
    ['nothing at all', undefined, undefined],
    ['a null, the way URLSearchParams reports absence', null, '151.2743'],
  ])('returns no spot for %s', (_label, lat, lon) => {
    expect(parseSpot(lat, lon)).toBeNull();
  });

  it.each([
    ['a blank value', '', ''],
    ['whitespace', '  ', '151.2743'],
  ])('treats %s as absent rather than as zero', (_label, lat, lon) => {
    // Number('') is 0, so without this `?lat=&lon=` would resolve to a point
    // in the Atlantic instead of to no spot at all.
    expect(parseSpot(lat, lon)).toBeNull();
  });

  it.each([
    ['text', 'here', '151.2743'],
    ['a latitude past the pole', '91', '151.2743'],
    ['a latitude past the south pole', '-91', '151.2743'],
    ['a longitude past the date line', '-33.8908', '181'],
    ['a longitude past the other date line', '-33.8908', '-181'],
  ])('rejects %s', (_label, lat, lon) => {
    expect(parseSpot(lat, lon)).toBeNull();
  });

  it.each([
    ['the north pole', '90', '0'],
    ['the south pole', '-90', '0'],
    ['the date line', '0', '180'],
    ['the other side of it', '0', '-180'],
  ])('accepts %s, which is on the planet', (_label, lat, lon) => {
    expect(parseSpot(lat, lon)).toEqual({ lat: Number(lat), lon: Number(lon) });
  });

  it('rejects a coordinate that is not finite', () => {
    expect(parseSpot('Infinity', '151.2743')).toBeNull();
    expect(parseSpot('NaN', '151.2743')).toBeNull();
  });
});
