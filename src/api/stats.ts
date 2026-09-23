import type { SnapshotHour } from '../domain/snapshots';
import { request } from './request';
import type { LatLon } from './types';

/**
 * What the app has learned about a spot over time, and what else is near it.
 *
 * All three of these read or write the snapshot history, which is the one
 * thing in the app that no forecast API could answer: the forecast says what
 * this weekend looks like, the history says what this place is usually like.
 */

export interface HourStat {
  /** Hour of the day, 0-23, in the spot's own time. */
  hour: number;
  avgScore: number;
  bestScore: number;
  samples: number;
}

export interface SpotStats {
  samples: number;
  days: number;
  byHour: HourStat[];
  distribution: { from: number; to: number; samples: number }[];
  factors: { tide: number; wind: number; wave: number; weather: number; windDir: number } | null;
  unfishableShare: number;
}

export interface NearbySpot extends LatLon {
  id: string;
  name: string;
  distanceM: number;
  /** The next hour held for it, if the history reaches that far. */
  nextAt: string | null;
  nextScore: number | null;
}

/**
 * Keep what the page is showing.
 *
 * Deliberately not part of any render path: a failure here should cost
 * nothing, so the caller does not await it and this never throws.
 */
export async function recordConditions(
  spotId: string,
  utcOffsetSeconds: number,
  hours: SnapshotHour[],
): Promise<void> {
  if (hours.length === 0) return;
  try {
    await request(`/api/spots/${spotId}/conditions`, {
      method: 'POST',
      body: JSON.stringify({ utcOffsetSeconds, hours }),
    });
  } catch {
    // Statistics are a bonus. Losing one batch of them is not worth a word on
    // screen, and the next time this spot is opened will send them again.
  }
}

export function fetchSpotStats(spotId: string, signal?: AbortSignal): Promise<SpotStats> {
  return request<SpotStats>(`/api/spots/${spotId}/stats`, { signal });
}

export function fetchNearby(at: LatLon, km = 25, signal?: AbortSignal): Promise<NearbySpot[]> {
  const query = new URLSearchParams({ lat: String(at.lat), lon: String(at.lon), km: String(km) });
  return request<NearbySpot[]>(`/api/spots/nearby?${query}`, { signal });
}
