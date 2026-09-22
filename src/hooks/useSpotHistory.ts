import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { SavedSpot } from '../api/spots';
import { fetchNearby, fetchSpotStats, recordConditions, type NearbySpot, type SpotStats } from '../api/stats';
import type { LatLon, TimelinePoint } from '../api/types';
import { snapshotHours } from '../domain/snapshots';
import type { TideExtreme } from '../domain/tides';

/** History changes slowly. Re-reading it while somebody reads the page is waste. */
const STALE_MS = 5 * 60 * 1000;

/** How far out the nearby list looks. Far enough to be a different beach. */
const NEARBY_KM = 25;

/**
 * Keep the forecast this page is showing, once per spot per hour.
 *
 * Nothing on screen waits for this and nothing shows when it fails. The guard
 * is a ref rather than a dependency list because the point is to suppress
 * repeats across renders, not to react to a change.
 */
export function useRecordConditions(
  spot: SavedSpot | null,
  timeline: TimelinePoint[],
  extremes: TideExtreme[],
  utcOffsetSeconds: number,
  now: number,
): void {
  const sent = useRef<string | null>(null);
  // `now` ticks every minute; the hours worth keeping only change when the
  // clock passes one. Rounding here keeps this off the per-minute path.
  const hourTick = Math.floor(now / 3_600_000);

  useEffect(() => {
    if (!spot || timeline.length === 0) return;

    const hours = snapshotHours(timeline, extremes, hourTick * 3_600_000);
    if (hours.length === 0) return;

    const key = `${spot.id}:${hours[0].at}`;
    if (sent.current === key) return;
    sent.current = key;

    void recordConditions(spot.id, utcOffsetSeconds, hours);
  }, [spot, timeline, extremes, utcOffsetSeconds, hourTick]);
}

export interface SpotHistory {
  stats: SpotStats | null;
  nearby: NearbySpot[];
  /**
   * False once a request has failed. The panel disappears rather than sitting
   * there erroring, the same way the saved-spot library does.
   */
  available: boolean;
}

/**
 * What is known about this spot beyond the current forecast.
 *
 * Two queries rather than one endpoint returning both: the stats belong to a
 * saved spot and the nearby list belongs to a place on the map, and those are
 * not the same thing — you can be looking at an unsaved point that still has
 * saved spots around it.
 */
export function useSpotHistory(spot: SavedSpot | null, at: LatLon | null): SpotHistory {
  const stats = useQuery({
    queryKey: ['spot-stats', spot?.id],
    queryFn: ({ signal }) => fetchSpotStats(spot!.id, signal),
    enabled: spot !== null,
    staleTime: STALE_MS,
  });

  const nearby = useQuery({
    queryKey: ['nearby', at?.lat, at?.lon],
    queryFn: ({ signal }) => fetchNearby(at!, NEARBY_KM, signal),
    enabled: at !== null,
    staleTime: STALE_MS,
  });

  return {
    stats: stats.data ?? null,
    nearby: nearby.data ?? [],
    available: !stats.isError && !nearby.isError,
  };
}

export { NEARBY_KM };
