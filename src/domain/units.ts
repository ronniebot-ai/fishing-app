const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

/** Bearing in degrees to a 16-point compass label. */
export function toCompass(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return '--';
  return COMPASS[Math.round(deg / 22.5) % 16];
}

/**
 * Format a spot-local wall-clock stamp for display.
 *
 * The stamp is already in the spot's timezone, so it is rendered as-is rather
 * than passed through Date formatting, which would re-interpret it in the
 * browser's zone and shift the time for interstate spots.
 */
export function formatHour(stamp: string): string {
  const time = stamp.slice(11, 16);
  const [h, m] = time.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

/** Day label such as "Mon 8 Sep" from a wall-clock stamp. */
export function formatDay(stamp: string): string {
  const [y, mo, d] = stamp.slice(0, 10).split('-').map(Number);
  // Constructed as UTC and read back as UTC so no timezone shift can occur.
  const date = new Date(Date.UTC(y, mo - 1, d));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo - 1];
  return `${weekday} ${d} ${month}`;
}

/**
 * Render an epoch as spot-local time.
 *
 * Used for interpolated moments (tide turns) that have no wall-clock stamp of
 * their own. The offset is the spot's, taken from the API response.
 */
export function epochToSpotTime(t: number, utcOffsetSeconds: number): string {
  const shifted = new Date(t + utcOffsetSeconds * 1000);
  const h = shifted.getUTCHours();
  const m = shifted.getUTCMinutes();
  const suffix = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

/** Coordinate pair for display, e.g. "33.8900°S 151.2740°E". */
export function formatLatLon(lat: number, lon: number): string {
  const ns = lat < 0 ? 'S' : 'N';
  const ew = lon < 0 ? 'W' : 'E';
  return `${Math.abs(lat).toFixed(4)}°${ns} ${Math.abs(lon).toFixed(4)}°${ew}`;
}

/** Verbal band for a 0-100 score. */
export function scoreBand(score: number): { label: string; tone: 'poor' | 'fair' | 'good' | 'prime' } {
  if (score >= 75) return { label: 'Prime', tone: 'prime' };
  if (score >= 55) return { label: 'Good', tone: 'good' };
  if (score >= 35) return { label: 'Fair', tone: 'fair' };
  return { label: 'Poor', tone: 'poor' };
}
