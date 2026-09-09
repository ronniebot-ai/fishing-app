import { useCallback, useEffect, useState } from 'react';
import './App.css';
import { FAR_ANCHOR_KM } from './api/oceanSnap';
import type { LatLon } from './api/types';
import { Readout } from './components/Readout';
import { SpotMap } from './components/SpotMap';
import { TideChart } from './components/TideChart';
import { TideTable } from './components/TideTable';
import { Verdict } from './components/Verdict';
import { WhenToGo } from './components/WhenToGo';
import { WindRainChart } from './components/WindRainChart';
import { describeConditions } from './domain/describe';
import { formatDay, formatHour, formatLatLon } from './domain/units';
import { useConditions } from './hooks/useConditions';
import { useNow } from './hooks/useNow';

/** Read the selected spot out of the URL so a link restores it. */
function readSpotFromUrl(): LatLon | null {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('lat') || !params.has('lon')) return null;
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export default function App() {
  const [spot, setSpot] = useState<LatLon | null>(readSpotFromUrl);
  const now = useNow();
  const conditions = useConditions(spot, now);

  // Keep the URL in step with the selection so the page is shareable.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (spot) {
      url.searchParams.set('lat', String(spot.lat));
      url.searchParams.set('lon', String(spot.lon));
    } else {
      url.searchParams.delete('lat');
      url.searchParams.delete('lon');
    }
    window.history.replaceState(null, '', url);
  }, [spot]);

  // Restore the spot when the user navigates back or forward.
  useEffect(() => {
    const onPop = () => setSpot(readSpotFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const handlePick = useCallback((p: LatLon) => setSpot(p), []);

  // `now` here is the clock; the score for the current hour is `nowScore`.
  const {
    snap, timeline, extremes, now: nowScore, nowPoint,
    windows, utcOffsetSeconds, isLoading, error,
  } = conditions;

  const anchor = snap?.anchor ?? null;
  const anchorFar = snap !== null && anchor !== null && snap.distanceKm > FAR_ANCHOR_KM;
  const noMarine = snap !== null && anchor === null;
  const ready = Boolean(spot && !isLoading && !error && nowScore && nowPoint);

  return (
    <div className="app">
      <div className="map-rail">
        <SpotMap selected={spot} anchor={anchorFar ? anchor : null} onPick={handlePick} />
        <div className="spot-chip">
          {spot ? formatLatLon(spot.lat, spot.lon) : 'Tap the coast to pick a spot'}
        </div>
      </div>

      <div className="instrument">
        <header className="mast">
          <h1>Tideline</h1>
          {ready && nowPoint && (
            <div className="when">
              <b>{formatDay(nowPoint.time)}</b>
              <span>{formatHour(nowPoint.time)} local</span>
            </div>
          )}
        </header>

        {!spot && (
          <p className="placeholder">
            <b>Pick a spot on the map.</b>
            Wind, swell, tide and rain for anywhere on the Australian coast, and a
            straight answer on whether it is worth going.
          </p>
        )}

        {spot && error && (
          <p className="error" role="alert">
            <b>Could not load the forecast.</b>
            {error.message} Check your connection and pick the spot again.
          </p>
        )}

        {spot && isLoading && !error && (
          <div className="loading">
            <span className="label">Reading the forecast…</span>
            <span className="bar" />
          </div>
        )}

        {ready && nowScore && nowPoint && (
          <>
            {/* The caveat comes before the verdict: tide carries the most
                weight in that call, so how far away it was measured has to be
                visible at the same moment. */}
            {anchorFar && anchor && (
              <p className="caveat">
                <b>Swell and tide are measured {snap!.distanceKm.toFixed(0)} km away,</b> at
                the nearest cell the wave model covers — the ringed mark on the map.
                Wind and rain are for the spot you picked. Read the call as a guide to
                the open water nearby, not to this exact place.
              </p>
            )}

            {noMarine && (
              <p className="caveat">
                <b>No marine data here.</b> This spot is too far inland for the wave
                model, so there is no swell or tide — only wind and rain.
              </p>
            )}

            <Verdict
              score={nowScore}
              summary={describeConditions(
                nowPoint, extremes, timeline, now, utcOffsetSeconds, nowScore.score,
              )}
            />

            <TideChart
              points={timeline}
              extremes={extremes}
              windows={windows}
              utcOffsetSeconds={utcOffsetSeconds}
              now={now}
            />
            {extremes.length > 0 && (
              <div className="chart-foot">
                <span className="now">now</span>
                <span>shaded hours are worth fishing</span>
              </div>
            )}

            <Readout
              point={nowPoint}
              score={nowScore}
              extremes={extremes}
              utcOffsetSeconds={utcOffsetSeconds}
            />

            <WhenToGo windows={windows} utcOffsetSeconds={utcOffsetSeconds} now={now} />

            <TideTable extremes={extremes} utcOffsetSeconds={utcOffsetSeconds} now={now} />

            <h2 className="sec">Wind and rain</h2>
            <WindRainChart points={timeline} utcOffsetSeconds={utcOffsetSeconds} now={now} />
            <div className="legend">
              <span>
                <i style={{ background: 'var(--curve)' }} />
                Wind
              </span>
              <span>
                <i style={{ background: 'var(--gust)' }} />
                Gusts
              </span>
              <span>Dashed line marks 25 knots, where most shore fishing stops</span>
            </div>

            <p className="disclosure">
              Forecasts come from Open-Meteo. Tides are modelled globally rather than
              taken from Australian tide tables, so turns can run 20–40 minutes out and
              heights sit against mean sea level, not the chart datum BOM publishes.
              The wave model resolves about 9 km, so harbours and water behind a
              breakwall run calmer than shown. Check BOM before you go.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
