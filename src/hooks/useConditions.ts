import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fetchForecast, fetchMarine } from '../api/openMeteo';
import { snapToOcean, type SnapResult } from '../api/oceanSnap';
import type { LatLon, TimelinePoint } from '../api/types';
import { findBestWindows, scoreHour, type FishingScore, type FishingWindow } from '../domain/score';
import { lightWindows, sunEvents, twilightMs, type LightWindow } from '../domain/daylight';
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
  /** Sun crossings as instants, for the spine's night shading. */
  sunrises: number[];
  sunsets: number[];
  /**
   * How long civil twilight runs either side of them, or null where the sun
   * does not cross both altitudes — which is the spine's cue to draw a hard
   * edge instead of a soft one.
   */
  twilight: number | null;
  /**
   * The dawn and dusk windows, derived from the three above. Everything that
   * scores an hour needs them, so they are built once here rather than in
   * each caller — two callers deriving them slightly differently is how a
   * stored score and a drawn score start to disagree.
   */
  light: LightWindow[];
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
export function useConditions(
  point: LatLon | null,
  now: number,
  /**
   * How far ahead to look for windows, and how many to keep. Measured from
   * `now` rather than from the drawn window: dragging the chart into next
   * weekend should not change the answer to "when should I go".
   */
  windowHours = 48,
  windowLimit = 3,
): Conditions {
  const key = point ? [point.lat, point.lon] : ['none'];
  // Pulled out as a number so the memo below depends on the latitude rather
  // than on the identity of the object carrying it.
  const lat = point?.lat ?? null;

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
        sunrises: [], sunsets: [], twilight: null, light: [],
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

    const sun = sunEvents(forecast, forecast.utc_offset_seconds);
    // Recomputed on the minute with everything else here, which costs nothing:
    // the length of twilight moves by seconds across a whole week.
    const twilight = lat === null ? null : twilightMs(lat, now);
    const light = lightWindows(sun.sunrises, sun.sunsets, twilight);

    return {
      timeline,
      extremes,
      now: nowPoint ? scoreHour(nowPoint, extremes, light) : null,
      nowPoint,
      windows: findBestWindows(timeline, extremes, {
        now, light, horizonHours: windowHours, limit: windowLimit,
      }),
      ...sun,
      twilight,
      light,
      snap: snapQuery.data ?? null,
      utcOffsetSeconds: forecast.utc_offset_seconds,
      timezone: forecast.timezone,
      isLoading,
      error: (forecastQuery.error as Error) ?? (marineQuery.error as Error) ?? null,
    };
  }, [
    forecastQuery.data, forecastQuery.isLoading, forecastQuery.error,
    marineQuery.data, marineQuery.isLoading, marineQuery.error,
    snapQuery.data, snapQuery.isLoading, anchor, lat, now, windowHours, windowLimit,
  ]);
}
