import { probeMarineBatch } from './openMeteo';
import type { LatLon } from './types';

/**
 * Spacing of the Open-Meteo marine grid, in degrees.
 *
 * Measured against the live API: requests at lon 151.20 through 151.28 all
 * collapse onto the same cell (151.29167), and adjacent cells sit at
 * 151.29167 / 151.37502 — a step of ~0.08333deg, roughly 9.3 km.
 *
 * Candidates must be spaced by at least this much or they probe the same cell
 * and the extra requests are wasted.
 */
export const MARINE_GRID_STEP = 0.0833333;

/** Rings of candidates to search outward. 3 rings reaches ~28 km. */
const RINGS = 3;

/** Compass directions probed per ring. */
const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];

/** Beyond this the anchor is too far to silently attribute to the clicked point. */
export const FAR_ANCHOR_KM = 10;

const EARTH_RADIUS_KM = 6371;
const CACHE_KEY = 'fishing-app:ocean-snap:v1';

export interface SnapResult {
  /** Nearest ocean grid cell, or null when none was found within range. */
  anchor: LatLon | null;
  /** Distance from the clicked point to the anchor, in km. */
  distanceKm: number;
}

export function haversineKm(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Candidate ocean cells to probe, ordered nearest-first: the clicked point,
 * then concentric rings of 8 bearings each.
 *
 * Longitude offsets are divided by cos(latitude) so a ring is a true circle on
 * the ground rather than an ellipse squashed by the meridian convergence.
 */
export function buildCandidates(point: LatLon, rings = RINGS): LatLon[] {
  const candidates: LatLon[] = [{ lat: point.lat, lon: point.lon }];
  const lonScale = Math.max(Math.cos((point.lat * Math.PI) / 180), 0.01);

  for (let ring = 1; ring <= rings; ring++) {
    const d = MARINE_GRID_STEP * ring;
    for (const bearing of BEARINGS) {
      const rad = (bearing * Math.PI) / 180;
      candidates.push({
        lat: round4(point.lat + d * Math.cos(rad)),
        lon: round4(point.lon + (d * Math.sin(rad)) / lonScale),
      });
    }
  }
  return candidates;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Cache key granularity: ~1 km, so nearby clicks reuse the same lookup. */
function cacheKeyFor(point: LatLon): string {
  return `${point.lat.toFixed(2)},${point.lon.toFixed(2)}`;
}

type CacheShape = Record<string, SnapResult>;

function readCache(): CacheShape {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CacheShape) : {};
  } catch {
    // Private browsing, blocked storage, or corrupt JSON — behave as empty.
    return {};
  }
}

function writeCache(key: string, value: SnapResult): void {
  try {
    const cache = readCache();
    cache[key] = value;
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Caching is an optimisation; failing to persist must not break lookup.
  }
}

/**
 * Find the nearest marine grid cell that actually carries ocean data.
 *
 * The marine model returns an all-null series for land cells, so the only
 * reliable test is whether wave_height contains a non-null value. All 25
 * candidates go out as a single batched request.
 *
 * Results are cached permanently: the model grid does not move.
 */
export async function snapToOcean(
  point: LatLon,
  signal?: AbortSignal,
): Promise<SnapResult> {
  const key = cacheKeyFor(point);
  const cached = readCache()[key];
  if (cached) return cached;

  const candidates = buildCandidates(point);
  const responses = await probeMarineBatch(candidates, signal);

  let result: SnapResult = { anchor: null, distanceKm: 0 };

  for (let i = 0; i < responses.length; i++) {
    const waves = responses[i]?.hourly?.wave_height;
    if (waves?.some((v) => v !== null)) {
      // Use the grid cell the API resolved to, not our candidate guess, so
      // repeat requests hit exactly the same cell.
      const anchor: LatLon = {
        lat: responses[i].latitude,
        lon: responses[i].longitude,
      };
      result = { anchor, distanceKm: haversineKm(point, anchor) };
      break;
    }
  }

  writeCache(key, result);
  return result;
}
