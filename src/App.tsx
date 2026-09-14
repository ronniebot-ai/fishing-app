import { Alert, Skeleton } from 'antd';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import { FAR_ANCHOR_KM } from './api/oceanSnap';
import { findSaved, type SavedSpot } from './api/spots';
import type { LatLon } from './api/types';
import { Readout } from './components/Readout';
import { SaveSpot } from './components/SaveSpot';
import { SavedSpots } from './components/SavedSpots';
import { Spine } from './components/Spine';
import { SpotMap } from './components/SpotMap';
import { Verdict } from './components/Verdict';
import { describeConditions } from './domain/describe';
import { scoreHour } from './domain/score';
import { formatDay, formatHour, formatLatLon } from './domain/units';
import { useConditions } from './hooks/useConditions';
import { useNow } from './hooks/useNow';
import { useSavedSpots } from './hooks/useSavedSpots';

// antd's Table and Tabs are the heaviest import in the app, and nothing they
// render exists until a spot has been picked and its forecast has landed. That
// wait is a free place to load them.
const DataTables = lazy(() => import('./components/DataTables'));

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
  const [cursorT, setCursorT] = useState<number | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  // Where to fly the map, set only by choosing a saved spot. Clicking the map
  // must not move it under the user's finger, so `handlePick` leaves this be.
  const [focus, setFocus] = useState<LatLon | null>(null);
  const now = useNow();
  const conditions = useConditions(spot, now);
  const library = useSavedSpots();
  const savedHere = findSaved(library.spots, spot);

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

  const handlePick = useCallback((p: LatLon) => {
    setSpot(p);
    // The map has done its job; give the screen back to the readings.
    setMapOpen(false);
  }, []);

  const handleSelectSaved = useCallback((saved: SavedSpot) => {
    // A fresh object every time, so returning to the spot you are already on
    // still flies the map back to it after you have panned away.
    setFocus({ lat: saved.lat, lon: saved.lon });
    setSpot({ lat: saved.lat, lon: saved.lon });
    setMapOpen(false);
  }, []);

  // `now` here is the clock; the score for the current hour is `nowScore`.
  const {
    snap, timeline, extremes, now: nowScore, nowPoint,
    windows, utcOffsetSeconds, isLoading, error,
  } = conditions;

  // The readings follow the cursor on the spine, falling back to this hour
  // when it leaves. Both the point and its score are real: the hovered hour is
  // a sample the model produced, re-scored by the same function.
  const reading = useMemo(() => {
    if (cursorT === null || !nowPoint || !nowScore) return { point: nowPoint, score: nowScore };
    const point = timeline.find((p) => p.t === cursorT);
    if (!point) return { point: nowPoint, score: nowScore };
    return { point, score: scoreHour(point, extremes) };
  }, [cursorT, timeline, extremes, nowPoint, nowScore]);

  const anchor = snap?.anchor ?? null;
  const anchorFar = snap !== null && anchor !== null && snap.distanceKm > FAR_ANCHOR_KM;
  const noMarine = snap !== null && anchor === null;
  const ready = Boolean(spot && !isLoading && !error && nowScore && nowPoint);

  // Without a spot the map is the only thing to do, so it takes the screen.
  const mapState = !spot || mapOpen ? 'open' : 'closed';

  return (
    <div className="app" data-map={mapState}>
      <div className="map-rail">
        <SpotMap
          selected={spot}
          anchor={anchorFar ? anchor : null}
          saved={library.spots}
          focus={focus}
          onPick={handlePick}
          onSelectSaved={handleSelectSaved}
        />
        <div className="spot-chip">
          {savedHere?.name ?? (spot ? formatLatLon(spot.lat, spot.lon) : 'Tap the coast to pick a spot')}
        </div>
        {spot && (
          <button
            type="button"
            className="map-toggle"
            aria-expanded={mapOpen}
            onClick={() => setMapOpen((open) => !open)}
          >
            {mapOpen ? 'Hide map' : 'Change spot'}
          </button>
        )}
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

        {library.available && (spot || library.spots.length > 0) && (
          <div className="spots">
            {spot && (
              <SaveSpot
                // A half-typed name belongs to the spot it was typed for, so
                // picking a different one starts the field over.
                key={`${spot.lat},${spot.lon}`}
                spot={spot}
                saved={savedHere}
                saving={library.saving}
                error={library.saveError}
                onSave={(name) => library.save(spot, name)}
              />
            )}
            <SavedSpots
              spots={library.spots}
              selected={spot}
              onSelect={handleSelectSaved}
              onRename={library.rename}
              onRemove={library.remove}
            />
          </div>
        )}

        {!spot && (
          <p className="placeholder">
            <b>Pick a spot on the map.</b>
            Wind, swell, tide and rain for anywhere on the Australian coast, and a
            straight answer on whether it is worth going.
          </p>
        )}

        {spot && error && (
          <Alert
            className="state"
            type="error"
            showIcon={false}
            title="Could not load the forecast."
            description={`${error.message} Check your connection and pick the spot again.`}
          />
        )}

        {spot && isLoading && !error && (
          <div className="loading">
            <Skeleton active title={{ width: 180 }} paragraph={{ rows: 2, width: ['60%', '40%'] }} />
            <Skeleton.Node active style={{ width: '100%', height: 300 }} />
          </div>
        )}

        {ready && nowScore && nowPoint && reading.point && reading.score && (
          <>
            {/* The caveat comes before the verdict: tide carries the most
                weight in that call, so how far away it was measured has to be
                visible at the same moment. */}
            {anchorFar && anchor && (
              <Alert
                className="state"
                type="warning"
                showIcon={false}
                title={`Swell and tide are measured ${snap!.distanceKm.toFixed(0)} km away,`}
                description="at the nearest cell the wave model covers — the ringed mark on the map. Wind and rain are for the spot you picked. Read the call as a guide to the open water nearby, not to this exact place."
              />
            )}

            {noMarine && (
              <Alert
                className="state"
                type="warning"
                showIcon={false}
                title="No marine data here."
                description="This spot is too far inland for the wave model, so there is no swell or tide — only wind and rain."
              />
            )}

            <Verdict
              score={nowScore}
              summary={describeConditions(
                nowPoint, extremes, timeline, now, utcOffsetSeconds, nowScore.score,
              )}
            />

            <Readout
              point={reading.point}
              score={reading.score}
              extremes={extremes}
              utcOffsetSeconds={utcOffsetSeconds}
            />

            <div className="spine-head">
              <h2>Next two days</h2>
              <span className="cursor-time">
                {cursorT === null
                  ? `${formatHour(nowPoint.time)} · now`
                  : `${formatHour(reading.point.time)}`}
              </span>
            </div>

            <Spine
              points={timeline}
              extremes={extremes}
              windows={windows}
              utcOffsetSeconds={utcOffsetSeconds}
              now={now}
              onCursor={setCursorT}
            />

            <div className="spine-foot">
              <div className="legend">
                <span>
                  <i style={{ background: 'var(--curve)' }} />
                  Tide and wind
                </span>
                <span>
                  <i style={{ background: 'var(--gust)' }} />
                  Gusts
                </span>
                <span className="now">| now</span>
              </div>
              <span>Shaded hours are worth fishing · dashed line marks 25 knots</span>
            </div>

            <Suspense fallback={<Skeleton className="tables-loading" active paragraph={{ rows: 4 }} />}>
              <DataTables
                windows={windows}
                extremes={extremes}
                utcOffsetSeconds={utcOffsetSeconds}
                now={now}
              />
            </Suspense>

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
