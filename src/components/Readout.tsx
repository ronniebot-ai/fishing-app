import type { CSSProperties, ReactNode } from 'react';
import type { TimelinePoint } from '../api/types';
import { bearingWord } from '../domain/describe';
import type { FactorKey, FishingScore } from '../domain/score';
import { surroundingTides, type TideExtreme } from '../domain/tides';
import { epochToSpotTime } from '../domain/units';

interface RowProps {
  label: string;
  value: string | null;
  unit?: string;
  note?: ReactNode;
  /** Quality 0-1 of this reading's contribution to the score. */
  contribution: number | null;
  /** Shown in place of the value when the reading is unavailable. */
  missing?: string;
}

function Row({ label, value, unit, note, contribution, missing }: RowProps) {
  const absent = value === null;
  const style = {
    '--contrib': `${(contribution ?? 0) * 100}%`,
  } as CSSProperties;

  return (
    <div className={`row${absent ? ' is-missing' : ''}`} style={style}>
      <span className="k">{label}</span>
      <span className="v">
        {absent ? (missing ?? 'No data') : value}
        {!absent && unit && <u>{unit}</u>}
      </span>
      <span className="n">{note}</span>
    </div>
  );
}

interface ReadoutProps {
  point: TimelinePoint;
  score: FishingScore;
  extremes: TideExtreme[];
  utcOffsetSeconds: number;
}

/**
 * The four readings, as an aligned block rather than four boxes.
 *
 * Each row carries a hairline whose width is that reading's contribution to
 * the score, so the headline number is always accountable to something
 * visible without a separate breakdown panel.
 */
export function Readout({ point, score, extremes, utcOffsetSeconds }: ReadoutProps) {
  const factor = (key: FactorKey) => score.factors.find((f) => f.key === key)?.value ?? null;
  const { next } = surroundingTides(extremes, point.t);

  const windNote =
    point.windSpeed === null
      ? undefined
      : [
          bearingWord(point.windDir) ?? 'direction unknown',
          point.windGust !== null ? `gusting ${Math.round(point.windGust)}` : null,
        ]
          .filter(Boolean)
          .join(', ');

  // Swell rather than the combined sea, because that is what the score reads:
  // a row showing one number while the hairline under it measures another is
  // worse than showing neither.
  const swellNote =
    point.swellHeight === null
      ? undefined
      : [
          bearingWord(point.swellDir) ?? null,
          point.swellPeriod !== null ? `${point.swellPeriod.toFixed(0)} second period` : null,
        ]
          .filter(Boolean)
          .join(', ');

  let tideNote: ReactNode;
  if (point.tideRate !== null) {
    const rate = Math.abs(point.tideRate);
    const slack = rate < 0.04;
    tideNote = (
      <>
        {/* Italic for water in motion, following chart convention. */}
        <em>{slack ? 'slack' : point.tideRate > 0 ? 'rising' : 'falling'}</em>
        {!slack && ` ${rate.toFixed(2)} m an hour`}
        {next &&
          `, ${next.kind === 'high' ? 'high' : 'low'} at ${epochToSpotTime(next.t, utcOffsetSeconds)}`}
      </>
    );
  }

  // Rain is the note under the cloud rather than a row of its own: it is what
  // decides the factor when it falls, and silence the rest of the time.
  const weatherNote = [
    point.precip !== null && point.precip >= 0.05 ? `${point.precip.toFixed(1)} mm this hour` : null,
    point.precipProb === null
      ? null
      : point.precipProb < 5
        ? 'no rain forecast'
        : `${Math.round(point.precipProb)}% chance of rain`,
  ]
    .filter(Boolean)
    .join(', ') || undefined;

  return (
    <div className="readout">
      <Row
        label="Wind"
        value={point.windSpeed === null ? null : String(Math.round(point.windSpeed))}
        unit="kn"
        note={windNote}
        contribution={factor('wind')}
      />
      <Row
        label="Swell"
        value={point.swellHeight === null ? null : point.swellHeight.toFixed(1)}
        unit="m"
        note={swellNote}
        contribution={factor('wave')}
        missing="inland"
      />
      <Row
        label="Tide"
        value={
          point.tideHeight === null
            ? null
            : `${point.tideHeight > 0 ? '+' : ''}${point.tideHeight.toFixed(2)}`
        }
        unit="m"
        note={tideNote}
        contribution={factor('tide')}
        missing="inland"
      />
      <Row
        label="Weather"
        value={point.cloudCover === null ? null : String(Math.round(point.cloudCover))}
        unit={point.cloudCover === null ? undefined : '% cloud'}
        note={weatherNote}
        contribution={factor('weather')}
      />
    </div>
  );
}
