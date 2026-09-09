import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fetchForecast, fetchMarine } from '../api/openMeteo';
import { snapToOcean, type SnapResult } from '../api/oceanSnap';
import type { LatLon, TimelinePoint } from '../api/types';
import { findBestWindows, scoreHour, type FishingScore, type FishingWindow } from '../domain/score';
import { findTideExtremes, type TideExtreme } from '../domain/tides';
import { buildTimeline, currentIndex } from '../domain/timeline';

/** Model data refreshes hourly, so refetching more often than this is wasted. */
const STALE_MS = 30 * 60 * 1000;

export interface Conditions {
  timeline: TimelinePoint[];
  extremes: TideExtreme[];
  /** Score for the hour nearest to now. */
  now: FishingScore | null;
  /** The timeline entry nearest to now. */
  nowPoint: TimelinePoint | null;
  windows: FishingWindow[];
  snap: SnapResult | null;
  /** Spot-local UTC offset, for rendering interpolated tide times. */
  utcOffsetSeconds: number;
  timezone: string;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetch and assemble everything the app shows for one location.
 *
 * Ordering matters: the ocean snap has to resolve before the marine request
 * can be aimed, but the atmospheric forecast for the clicked point is
 * independent and runs in parallel with it.
 */
export function useConditions(point: LatLon | null, now: number): Conditions {
  const key = point ? [point.lat, point.lon] : ['none'];

  const snapQuery = useQuery({
    queryKey: ['snap', ...key],
    queryFn: ({ signal }) => snapToOcean(point!, signal),
    enabled: point !== null,
    staleTime: Infinity, // The model grid never moves.
    gcTime: Infinity,
  });

  const forecastQuery = useQuery({
    queryKey: ['forecast', ...key],
    queryFn: ({ signal }) => fetchForecast(point!, signal),
    enabled: point !== null,
    staleTime: STALE_MS,
  });

  const anchor = snapQuery.data?.anchor ?? null;

  const marineQuery = useQuery({
    queryKey: ['marine', anchor?.lat, anchor?.lon],
    queryFn: ({ signal }) => fetchMarine(anchor!, signal),
    enabled: anchor !== null,
    staleTime: STALE_MS,
  });

  return useMemo(() => {
    const forecast = forecastQuery.data;
    const marine = marineQuery.data ?? null;

    // Marine is genuinely optional: an inland point still gets wind and rain.
    const marinePending = snapQuery.isLoading || (anchor !== null && marineQuery.isLoading);
    const isLoading = forecastQuery.isLoading || marinePending;

    if (!forecast) {
      return {
        timeline: [], extremes: [], now: null, nowPoint: null, windows: [],
        snap: snapQuery.data ?? null,
        utcOffsetSeconds: 0, timezone: '',
        isLoading,
        error: (forecastQuery.error as Error) ?? null,
      };
    }

    const timeline = buildTimeline(forecast, marine);
    const extremes = findTideExtremes(timeline);
    const idx = currentIndex(timeline, now);
    const nowPoint = idx >= 0 ? timeline[idx] : null;

    return {
      timeline,
      extremes,
      now: nowPoint ? scoreHour(nowPoint, extremes) : null,
      nowPoint,
      windows: findBestWindows(timeline, extremes, { now }),
      snap: snapQuery.data ?? null,
      utcOffsetSeconds: forecast.utc_offset_seconds,
      timezone: forecast.timezone,
      isLoading,
      error: (forecastQuery.error as Error) ?? (marineQuery.error as Error) ?? null,
    };
  }, [
    forecastQuery.data, forecastQuery.isLoading, forecastQuery.error,
    marineQuery.data, marineQuery.isLoading, marineQuery.error,
    snapQuery.data, snapQuery.isLoading, anchor, now,
  ]);
}
