import type { NearbySpot, SpotStats as Stats } from '../api/stats';
import type { LatLon } from '../api/types';
import { scoreBand } from '../domain/units';

interface SpotStatsProps {
  /** Null until this spot has been saved; the nearby list does not need one. */
  stats: Stats | null;
  nearby: NearbySpot[];
  /** How far the nearby list reached, for the heading. */
  km: number;
  onSelect: (at: LatLon) => void;
}

/** 14 -> "2pm". Hour of day only, so there is no date or zone to get wrong. */
function clock(hour: number): string {
  return `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}`;
}

/**
 * What this place is usually like, and what else is near it.
 *
 * The rest of the page answers "what is it doing this weekend". This answers
 * "what is this spot like", which is a different question and the only one
 * that needs the app to have been paying attention over time.
 *
 * The hour strip is 24 bars rather than a chart: the shape is the whole
 * message — a spot that fishes at dawn looks different at a glance from one
 * that fishes on the afternoon sea breeze — and axes would only add furniture
 * around something already legible.
 */
export function SpotStats({ stats, nearby, km, onSelect }: SpotStatsProps) {
  const byHour = stats?.byHour ?? [];
  const best = byHour.reduce<(typeof byHour)[number] | null>(
    (top, hour) => (top === null || hour.avgScore > top.avgScore ? hour : top),
    null,
  );

  const hasHistory = (stats?.samples ?? 0) > 0;

  // `stats` is null for a point that has not been saved, which is the only
  // case with nothing to say. A saved spot with nothing kept yet still gets
  // the block, because "this will fill in" is worth saying once.
  if (stats === null && nearby.length === 0) return null;

  return (
    <section className="history">
      {stats !== null && (
        <>
          <h2 className="sec">This spot</h2>
          {hasHistory ? (
            <>
              <p className="history-sub">
                {best && (
                  <>
                    Usually best around <b>{clock(best.hour)}</b>.{' '}
                  </>
                )}
                From {stats.samples.toLocaleString()} hours kept over the last {stats.days} days
                {stats.unfishableShare > 0 && (
                  <>, {Math.round(stats.unfishableShare * 100)}% of them unfishable</>
                )}
                .
              </p>

              <div className="hours" role="img" aria-label="Average score by hour of day">
                {Array.from({ length: 24 }, (_, hour) => {
                  const stat = byHour.find((h) => h.hour === hour);
                  const score = stat?.avgScore ?? 0;
                  return (
                    <div
                      key={hour}
                      className={`hour tone-${scoreBand(score).tone}`}
                      data-empty={stat === undefined ? '' : undefined}
                      style={{ '--h': `${score}%` } as React.CSSProperties}
                      title={
                        stat
                          ? `${clock(hour)}: ${stat.avgScore} average, ${stat.bestScore} best, ${stat.samples} hours`
                          : `${clock(hour)}: nothing kept`
                      }
                    >
                      <i />
                    </div>
                  );
                })}
              </div>
              <div className="hours-axis">
                <span>12am</span>
                <span>6am</span>
                <span>noon</span>
                <span>6pm</span>
              </div>
            </>
          ) : (
            <p className="empty">
              Nothing kept for this spot yet. Open it a few times over the next week and
              the hours it fishes best will show up here.
            </p>
          )}
        </>
      )}

      {nearby.length > 0 && (
        <>
          <h3>Within {km} km</h3>
          <ul className="nearby">
            {nearby.map((spot) => (
              <li key={spot.id}>
                <button type="button" onClick={() => onSelect({ lat: spot.lat, lon: spot.lon })}>
                  <span className="n">{spot.name}</span>
                  <span className="d">
                    {spot.distanceM < 1000
                      ? `${spot.distanceM} m`
                      : `${(spot.distanceM / 1000).toFixed(1)} km`}
                  </span>
                  {spot.nextScore !== null && (
                    <span className={`s tone-${scoreBand(spot.nextScore).tone}`}>
                      {spot.nextScore}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
