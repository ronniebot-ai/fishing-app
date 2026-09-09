import type { TideExtreme } from '../domain/tides';
import { epochToSpotTime } from '../domain/units';

interface TideTableProps {
  extremes: TideExtreme[];
  utcOffsetSeconds: number;
  now: number;
  /** How many upcoming turns to list. */
  limit?: number;
}

/** "today" / "tomorrow" / weekday, so a time is never ambiguous. */
function daySuffix(t: number, utcOffsetSeconds: number, now: number): string {
  const shift = (ms: number) => new Date(ms + utcOffsetSeconds * 1000);
  const at = shift(t);
  const today = shift(now);
  const days =
    (Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) -
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) /
    86_400_000;

  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    at.getUTCDay()
  ];
}

/**
 * The next tide turns.
 *
 * A tide table is the artefact anglers have used for a century, so it is set
 * as one — tabular figures, heights signed against mean sea level.
 */
export function TideTable({ extremes, utcOffsetSeconds, now, limit = 6 }: TideTableProps) {
  const upcoming = extremes.filter((e) => e.t >= now - 1800_000).slice(0, limit);
  if (upcoming.length === 0) return null;

  return (
    <>
      <h2 className="sec">Next tides</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Tide</th>
              <th>Time</th>
              <th className="r">Height</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.map((e) => (
              <tr key={e.t}>
                <td>{e.kind === 'high' ? 'High' : 'Low'}</td>
                <td className="big">
                  {epochToSpotTime(e.t, utcOffsetSeconds)} {daySuffix(e.t, utcOffsetSeconds, now)}
                </td>
                <td className="r big">
                  {e.height > 0 ? '+' : e.height < 0 ? '−' : ''}
                  {Math.abs(e.height).toFixed(2)} m
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
