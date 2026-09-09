/** Geographic point. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** Shape shared by every Open-Meteo response envelope. */
interface OpenMeteoEnvelope {
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  timezone_abbreviation: string;
  utc_offset_seconds: number;
}

/**
 * Marine endpoint response.
 *
 * Every hourly array is nullable per-element: a request that lands on a land
 * grid cell returns an array of the right length filled entirely with `null`.
 * That is the only reliable land/sea test — the `elevation` field is not
 * (verified: ocean cells have been observed reporting elevation 89).
 */
export interface MarineResponse extends OpenMeteoEnvelope {
  hourly: {
    time: string[];
    wave_height: (number | null)[];
    wave_period: (number | null)[];
    wave_direction: (number | null)[];
    swell_wave_height: (number | null)[];
    swell_wave_period: (number | null)[];
    sea_level_height_msl: (number | null)[];
  };
}

/** Minimal marine response used by the ocean-snap probe. */
export interface MarineProbeResponse extends OpenMeteoEnvelope {
  hourly: {
    time: string[];
    wave_height: (number | null)[];
  };
}

/** Forecast (atmospheric) endpoint response. */
export interface ForecastResponse extends OpenMeteoEnvelope {
  current: {
    time: string;
    wind_speed_10m: number;
    wind_direction_10m: number;
    wind_gusts_10m: number;
    precipitation: number;
  };
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    precipitation: (number | null)[];
    precipitation_probability: (number | null)[];
    wind_speed_10m: (number | null)[];
    wind_direction_10m: (number | null)[];
    wind_gusts_10m: (number | null)[];
  };
}

/**
 * One hour of merged conditions.
 *
 * Wind and rain come from the clicked point; wave and tide come from the
 * snapped ocean anchor, which may be some distance away. Marine fields stay
 * null when no ocean cell was reachable.
 */
export interface TimelinePoint {
  /** Local wall-clock ISO string, e.g. "2026-09-07T14:00". */
  time: string;
  /** Epoch ms, parsed as local wall-clock for ordering and "now" lookups. */
  t: number;
  windSpeed: number | null;
  windGust: number | null;
  windDir: number | null;
  precip: number | null;
  precipProb: number | null;
  temp: number | null;
  waveHeight: number | null;
  wavePeriod: number | null;
  waveDir: number | null;
  swellHeight: number | null;
  swellPeriod: number | null;
  /** Sea level relative to mean sea level (MSL), in metres. */
  tideHeight: number | null;
  /** Rate of tide change in m/hr, derived via central difference. */
  tideRate: number | null;
}
