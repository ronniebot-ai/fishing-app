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

  const swellNote =
    point.waveHeight === null
      ? undefined
      : [
          bearingWord(point.waveDir) ?? null,
          point.wavePeriod !== null ? `${point.wavePeriod.toFixed(0)} second period` : null,
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

  const rainNote =
    point.precipProb === null
      ? undefined
      : point.precipProb < 5
        ? 'nothing forecast'
        : `${Math.round(point.precipProb)}% chance this hour`;

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
        value={point.waveHeight === null ? null : point.waveHeight.toFixed(1)}
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
        label="Rain"
        value={
          point.precip === null ? null : point.precip < 0.05 ? 'none' : point.precip.toFixed(1)
        }
        unit={point.precip !== null && point.precip >= 0.05 ? 'mm' : undefined}
        note={rainNote}
        contribution={factor('rain')}
      />
    </div>
  );
}
