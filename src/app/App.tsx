'use client';

import { Alert, Skeleton } from 'antd';
import dynamic from 'next/dynamic';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import { FAR_ANCHOR_KM } from '../api/oceanSnap';
import { findSaved } from '../api/spots';
import type { LatLon } from '../api/types';
import { LoginModal } from '../components/LoginModal';
import { Readout } from '../components/Readout';
import { SaveSpot } from '../components/SaveSpot';
import { SavedSpots } from '../components/SavedSpots';
import { SpotStats } from '../components/SpotStats';
import { Spine } from '../components/Spine';
import { Verdict } from '../components/Verdict';
import { buildChatContext } from '../domain/chatContext';
import { describeConditions } from '../domain/describe';
import { scoreHour } from '../domain/score';
import { parseSpot } from '../domain/spotUrl';
import { formatDay, formatHour, formatLatLon } from '../domain/units';
import { useAuth } from '../hooks/useAuth';
import { useChatAvailable } from '../hooks/useChat';
import { useConditions } from '../hooks/useConditions';
import { useNow } from '../hooks/useNow';
import { useSavedSpots } from '../hooks/useSavedSpots';
import { NEARBY_KM, useRecordConditions, useSpotHistory } from '../hooks/useSpotHistory';

// antd's Table and Tabs are the heaviest import in the app, and nothing they
// render exists until a spot has been picked and its forecast has landed. That
// wait is a free place to load them.
const DataTables = lazy(() => import('../components/DataTables'));

// Split for the same reason, and on a stronger one: most builds have no key
// behind them, so this chunk is never asked for at all.
const SpotChat = lazy(() => import('../components/SpotChat'));

// react-leaflet reads `window` while it is being imported, so the module
// cannot be evaluated during the server render at all — `ssr: false` keeps it
// out of that pass rather than merely skipping its output. Nothing is lost:
// a map is not useful until it is interactive.
const SpotMap = dynamic(() => import('../components/SpotMap').then((m) => m.SpotMap), {
  ssr: false,
});

/**
 * The spot the URL names right now.
 *
 * Only the history listener needs this: the first spot comes from the server
 * through `initialSpot`, which is what lets a shared link render before it
 * hydrates. Both paths go through `parseSpot`, so neither can accept a
 * coordinate the other would reject.
 */
function readSpotFromUrl(): LatLon | null {
  const params = new URLSearchParams(window.location.search);
  return parseSpot(params.get('lat'), params.get('lon'));
}

export default function App({ initialSpot }: { initialSpot: LatLon | null }) {
  const [spot, setSpot] = useState<LatLon | null>(initialSpot);
  const [cursorT, setCursorT] = useState<number | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const auth = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
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
    // Below 900px a chosen spot collapses the map to an 88px strip, and that
    // strip is still a live Leaflet map — a tap on it would otherwise repick
    // from whatever sliver happens to be visible. Read the collapse as "let
    // me see the map" once, rather than a coordinate.
    if (spot && !mapOpen) {
      setMapOpen(true);
      return;
    }
    setSpot(p);
    // The map has done its job; give the screen back to the readings.
    setMapOpen(false);
  }, [spot, mapOpen]);

  // Takes a bare point rather than a SavedSpot: the saved list and the nearby
  // list both want it, and only the coordinates were ever read.
  // Saving, renaming, and removing all touch the shared store, so all three
  // stop at the same gate: run the action if logged in, otherwise ask for a
  // login and drop the action rather than queue it — the user presses the
  // button again once they are in, which is simpler than remembering intent
  // across a modal.
  const requireAuth = useCallback((action: () => void) => {
    if (!auth.loggedIn) {
      setLoginOpen(true);
      return;
    }
    action();
  }, [auth.loggedIn]);

  const handleSelectSaved = useCallback((at: LatLon) => {
    // A fresh object every time, so returning to the spot you are already on
    // still flies the map back to it after you have panned away.
    setFocus({ lat: at.lat, lon: at.lon });
    setSpot({ lat: at.lat, lon: at.lon });
    setMapOpen(false);
  }, []);

  // `now` here is the clock; the score for the current hour is `nowScore`.
  const {
    snap, timeline, extremes, now: nowScore, nowPoint,
    windows, utcOffsetSeconds, timezone, isLoading, error,
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

  // What the assistant is given to answer from: the same numbers the page is
  // drawn with, never a second fetch. Null until there is a forecast, which
  // is also what keeps `send` from firing into nothing.
  const chatContext = useMemo(() => {
    if (!spot || !ready) return null;
    return buildChatContext({
      spot,
      spotName: savedHere?.name ?? null,
      timeline, extremes, windows, snap, utcOffsetSeconds, timezone, now,
    });
  }, [spot, ready, savedHere?.name, timeline, extremes, windows, snap, utcOffsetSeconds, timezone, now]);

  const canAsk = useChatAvailable();

  // Keep what is on screen, and read back what previous visits recorded. The
  // recording is fire-and-forget: nothing here waits for it or shows when it
  // fails, because a missed batch costs a statistic and the next visit sends
  // the same hours again.
  useRecordConditions(savedHere, timeline, extremes, utcOffsetSeconds, now);
  const history = useSpotHistory(savedHere, spot);

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
          <div className="map-account">
            {auth.loggedIn ? (
              <>
                <span className="account-name">Admin</span>
                <button type="button" onClick={auth.logout}>
                  Log out
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setLoginOpen(true)}>
                Login
              </button>
            )}
          </div>
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
                onSave={(name) => requireAuth(() => library.save(spot, name))}
              />
            )}
            <SavedSpots
              spots={library.spots}
              selected={spot}
              onSelect={handleSelectSaved}
              onRename={(id, name) => requireAuth(() => library.rename(id, name))}
              onRemove={(id) => requireAuth(() => library.remove(id))}
            />
          </div>
        )}

        {/* Above the verdict, not below the tables. The question this answers
            is almost always about the number directly underneath it — "why is
            it only 54" — so it has to be in view at the moment that number
            is, rather than two screens further down where nobody finds it. */}
        {canAsk && chatContext && spot && (
          <Suspense fallback={null}>
            <SpotChat
              // The conversation was reasoning about the forecast for one
              // spot, so it does not survive picking another.
              key={`${spot.lat},${spot.lon}`}
              context={chatContext}
            />
          </Suspense>
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

            {/* Last, because it answers a different question from everything
                above it: not what this weekend looks like, but what this place
                is like. It disappears rather than erroring when the API is
                unreachable, the same way the saved-spot library does. */}
            {history.available && (
              <SpotStats
                stats={history.stats}
                nearby={history.nearby}
                km={NEARBY_KM}
                onSelect={handleSelectSaved}
              />
            )}

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

      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onLogin={auth.login}
      />
    </div>
  );
}
