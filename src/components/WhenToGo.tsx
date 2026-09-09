import type { FishingWindow } from '../domain/score';
import { epochToSpotTime, scoreBand } from '../domain/units';

interface WhenToGoProps {
  windows: FishingWindow[];
  utcOffsetSeconds: number;
  now: number;
}

/** Today / Tomorrow / weekday, in the spot's own timezone. */
function dayLabel(t: number, utcOffsetSeconds: number, now: number): string {
  const shift = (ms: number) => new Date(ms + utcOffsetSeconds * 1000);
  const at = shift(t);
  const today = shift(now);
  const days =
    (Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) -
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) /
    86_400_000;

  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    at.getUTCDay()
  ];
}

/**
 * The windows worth driving to, strongest first.
 *
 * Set as a table because that is what it is: three rows compared on the same
 * three measures. Ranking is carried by the order and the score, so numbered
 * markers would only repeat what the sort already says.
 */
export function WhenToGo({ windows, utcOffsetSeconds, now }: WhenToGoProps) {
  return (
    <>
      <h2 className="sec">When to go</h2>

      {windows.length === 0 ? (
        <p className="empty">
          Nothing worth a trip in the next two days — wind or swell is against you the
          whole way through. The forecast refreshes hourly, so it is worth another look
          this evening.
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Window</th>
                <th className="r">Best around</th>
                <th className="r">Score</th>
              </tr>
            </thead>
            <tbody>
              {windows.map((w) => {
                const band = scoreBand(w.score);
                const live = now >= w.startT && now < w.endT;
                return (
                  <tr key={w.startT} className={live ? 'is-now' : undefined}>
                    <td>{live ? 'Now' : dayLabel(w.startT, utcOffsetSeconds, now)}</td>
                    <td className="big">
                      {epochToSpotTime(w.startT, utcOffsetSeconds)} –{' '}
                      {epochToSpotTime(w.endT, utcOffsetSeconds)}
                    </td>
                    <td className="r big">{epochToSpotTime(w.peakT, utcOffsetSeconds)}</td>
                    <td className={`sc tone-${band.tone}`}>{w.score}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
