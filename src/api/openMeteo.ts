import type {
  ForecastResponse,
  LatLon,
  MarineProbeResponse,
  MarineResponse,
} from './types';

/**
 * Both models are read through this app's own edge function rather than
 * straight from Open-Meteo, so that everybody looking at the same stretch of
 * coast shares one cached answer — see src/app/api/forecast/[model]/route.ts.
 *
 * The path is relative because the page and the function are one deployment,
 * and the parameters are built in a fixed order because the URL is the cache
 * key.
 */
function endpoint(model: 'forecast' | 'marine', params: Record<string, string>): string {
  return `/api/forecast/${model}?${new URLSearchParams(params)}`;
}

/** How many days of forecast the app requests. The API allows up to 10. */
export const FORECAST_DAYS = 7;

const MARINE_HOURLY = [
  'wave_height',
  'wave_period',
  'wave_direction',
  'swell_wave_height',
  'swell_wave_period',
  'sea_level_height_msl',
].join(',');

const FORECAST_HOURLY = [
  'temperature_2m',
  'precipitation',
  'precipitation_probability',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
].join(',');

const FORECAST_CURRENT = [
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'precipitation',
].join(',');

/**
 * Open-Meteo returns a bare object for a single coordinate but a JSON array
 * when latitude/longitude are comma-separated lists. Normalise to an array so
 * callers only handle one shape.
 */
function toArray<T>(payload: T | T[]): T[] {
  return Array.isArray(payload) ? payload : [payload];
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    // Open-Meteo reports failures as {error: true, reason: "..."}.
    let reason = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.reason) reason = body.reason;
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new Error(`Open-Meteo request failed: ${reason}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Cheapest possible marine query for a batch of candidate points: one day of
 * wave height only. Used to decide which candidates are ocean cells.
 */
export async function probeMarineBatch(
  points: LatLon[],
  signal?: AbortSignal,
): Promise<MarineProbeResponse[]> {
  const url = endpoint('marine', {
    latitude: points.map((p) => p.lat).join(','),
    longitude: points.map((p) => p.lon).join(','),
    hourly: 'wave_height',
    forecast_days: '1',
  });
  const payload = await getJson<MarineProbeResponse | MarineProbeResponse[]>(
    url,
    signal,
  );
  return toArray(payload);
}

/** Full marine forecast (waves, swell, tide) for a single ocean anchor. */
export async function fetchMarine(
  point: LatLon,
  signal?: AbortSignal,
): Promise<MarineResponse> {
  const url = endpoint('marine', {
    latitude: String(point.lat),
    longitude: String(point.lon),
    hourly: MARINE_HOURLY,
    timezone: 'auto',
    forecast_days: String(FORECAST_DAYS),
  });
  const payload = await getJson<MarineResponse | MarineResponse[]>(url, signal);
  return toArray(payload)[0];
}

/**
 * Atmospheric forecast for the clicked point. Wind is requested in knots,
 * the unit Australian anglers and marine forecasts actually use.
 */
export async function fetchForecast(
  point: LatLon,
  signal?: AbortSignal,
): Promise<ForecastResponse> {
  const url = endpoint('forecast', {
    latitude: String(point.lat),
    longitude: String(point.lon),
    hourly: FORECAST_HOURLY,
    current: FORECAST_CURRENT,
    timezone: 'auto',
    forecast_days: String(FORECAST_DAYS),
    wind_speed_unit: 'kn',
  });
  const payload = await getJson<ForecastResponse | ForecastResponse[]>(
    url,
    signal,
  );
  return toArray(payload)[0];
}
