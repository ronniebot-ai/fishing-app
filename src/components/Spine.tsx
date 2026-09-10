import { useRef, useState } from 'react';
import type { TimelinePoint } from '../api/types';
import type { FishingWindow } from '../domain/score';
import type { TideExtreme } from '../domain/tides';
import { epochToSpotTime } from '../domain/units';
import { useElementWidth } from '../hooks/useElementWidth';

const HOUR = 3600_000;

/** Above this most shore and small-boat fishing stops. */
const CUTOFF_KN = 25;

const PAD_L = 42;
const PAD_R = 14;
const TOP = 16;
const H_TIDE = 130;
const H_WIND = 88;
const H_RAIN = 50;
const H_AXIS = 24;
const GAP = 10;

interface SpineProps {
  points: TimelinePoint[];
  extremes: TideExtreme[];
  windows: FishingWindow[];
  utcOffsetSeconds: number;
  now: number;
  hours?: number;
  /**
   * The instant under the cursor, or null when it leaves. The readings above
   * follow this, which is the whole reason the panels share an axis.
   */
  onCursor?: (t: number | null) => void;
}

/**
 * Tide, wind and rain on one time axis.
 *
 * These were three separate drawings, stacked with headings and tables between
 * them, which left the reader to align three x axes by eye. They are one
 * drawing now: a single scale, one `now` rule and one set of window bands, all
 * running the full height. A band that crosses all three panels is the point —
 * it says the hours are worth fishing *and* shows what the tide, wind and rain
 * are doing across exactly that span.
 *
 * Drawn by hand at true pixel scale rather than through a chart library. The
 * marks are specific — mean sea level, the 25-knot cutoff, interpolated turns
 * labelled in place — and a stretched viewBox would squash every label.
 */
export function Spine({
  points,
  extremes,
  windows,
  utcOffsetSeconds,
  now,
  hours = 48,
  onCursor,
}: SpineProps) {
  const holder = useRef<HTMLDivElement>(null);
  const width = useElementWidth(holder);
  const [cursorT, setCursorT] = useState<number | null>(null);

  const slice = points.filter((p) => p.t >= now - HOUR && p.t <= now + hours * HOUR);
  if (slice.length < 3) return null;

  const tidal = slice.filter((p) => p.tideHeight !== null);
  // Inland spots reach no ocean cell, so the tide panel simply is not drawn
  // and wind and rain close the gap.
  const hasTide = tidal.length >= 3;

  const topTide = TOP;
  const topWind = hasTide ? topTide + H_TIDE + GAP : TOP;
  const topRain = topWind + H_WIND + GAP;
  const rainBase = topRain + H_RAIN - 8;
  const height = topRain + H_RAIN + H_AXIS;

  const t0 = slice[0].t;
  const t1 = slice[slice.length - 1].t;
  const span = Math.max(t1 - t0, HOUR);
  const inner = Math.max(width - PAD_L - PAD_R, 1);
  const x = (t: number) => PAD_L + ((t - t0) / span) * inner;

  // --- tide scale -----------------------------------------------------------
  const heights = tidal.map((p) => p.tideHeight!);
  const lo = hasTide ? Math.min(...heights) : 0;
  const hi = hasTide ? Math.max(...heights) : 1;
  // Headroom so the H/L labels sit clear of the drawing's edges.
  const tMin = lo - (hi - lo) * 0.22 - 0.05;
  const tMax = hi + (hi - lo) * 0.22 + 0.05;
  const yTide = (h: number) => topTide + ((tMax - h) / (tMax - tMin)) * H_TIDE;

  // --- wind scale -----------------------------------------------------------
  const gusts = slice.map((p) => p.windGust ?? p.windSpeed ?? 0);
  const wMax = Math.max(...gusts, CUTOFF_KN) + 4;
  const yWind = (v: number) => topWind + (1 - v / wMax) * H_WIND;

  // --- rain scale -----------------------------------------------------------
  const rMax = Math.max(...slice.map((p) => p.precip ?? 0), 1);
  const yRain = (v: number) => rainBase - (v / rMax) * (H_RAIN - 10);

  /** Trace one hourly series, breaking the path wherever the data has a gap. */
  const trace = (read: (p: TimelinePoint) => number | null, y: (v: number) => number) => {
    let d = '';
    let open = false;
    for (const p of slice) {
      const v = read(p);
      if (v === null) {
        open = false;
        continue;
      }
      d += `${open ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(v).toFixed(1)} `;
      open = true;
    }
    return d.trim();
  };

  const tideLine = trace((p) => p.tideHeight, yTide);
  const areaPath = hasTide
    ? `${tideLine} L${x(tidal[tidal.length - 1].t).toFixed(1)},${yTide(tMin).toFixed(1)} ` +
      `L${x(tidal[0].t).toFixed(1)},${yTide(tMin).toFixed(1)} Z`
    : '';

  const visibleTurns = extremes.filter((e) => e.t >= t0 && e.t <= t1);

  // Local midnights: the only vertical structure the reader needs, plus a
  // lighter rule every three hours to make the axis readable at a glance.
  const ticks: { t: number; midnight: boolean }[] = [];
  const first = new Date(t0 + utcOffsetSeconds * 1000);
  const startOfDay = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
  for (let h = 0; h <= (hours + 24) / 3; h++) {
    const t = startOfDay + h * 3 * HOUR - utcOffsetSeconds * 1000;
    if (t <= t0 || t >= t1) continue;
    const local = new Date(t + utcOffsetSeconds * 1000);
    ticks.push({ t, midnight: local.getUTCHours() === 0 });
  }

  const bandTop = topTide - 8;
  const bandHeight = rainBase - bandTop;

  function report(t: number | null) {
    setCursorT(t);
    onCursor?.(t);
  }

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - rect.left - PAD_L) / inner) * span;
    // Snap to a real sample. The forecast is hourly, and interpolating would
    // put a number on screen the model never produced.
    let best = slice[0];
    for (const p of slice) {
      if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    }
    report(best.t);
  }

  const label = (y: number, text: string, unit: string) => (
    <>
      <text x={PAD_L - 7} y={y + 11} fill="var(--dim)" fontSize={11} fontFamily="var(--cond)" textAnchor="end">
        {text}
      </text>
      <text
        x={PAD_L - 7}
        y={y + 23}
        fill="var(--dim)"
        fontSize={10}
        fontFamily="var(--cond)"
        textAnchor="end"
        opacity={0.7}
      >
        {unit}
      </text>
    </>
  );

  return (
    <div className="spine-holder" ref={holder}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Tide, wind and rain over the next ${hours} hours on one time axis, with the hours worth fishing shaded`}
          onMouseMove={onMove}
          onMouseLeave={() => report(null)}
        >
          {/* Window bands run the full height: one band, three readings. */}
          {windows.map((w) => (
            <rect
              key={w.startT}
              x={x(Math.max(w.startT, t0))}
              y={bandTop}
              width={Math.max(0, x(Math.min(w.endT, t1)) - x(Math.max(w.startT, t0)))}
              height={bandHeight}
              fill="var(--wash)"
            />
          ))}

          {ticks.map((tick) => (
            <line
              key={tick.t}
              x1={x(tick.t)}
              y1={bandTop}
              x2={x(tick.t)}
              y2={rainBase}
              stroke="var(--rule)"
              strokeWidth={1}
              strokeDasharray={tick.midnight ? undefined : '2 4'}
              opacity={tick.midnight ? 0.9 : 0.5}
            />
          ))}

          {/* ---- tide ---- */}
          {hasTide && (
            <>
              <line
                x1={PAD_L}
                y1={yTide(0)}
                x2={width - PAD_R}
                y2={yTide(0)}
                stroke="var(--rule)"
                strokeWidth={1}
              />
              <text
                x={PAD_L - 7}
                y={yTide(0) + 3.5}
                fill="var(--dim)"
                fontSize={10}
                fontFamily="var(--cond)"
                textAnchor="end"
              >
                MSL
              </text>
              <path d={areaPath} fill="var(--curve-fill)" stroke="none" />
              <path
                d={tideLine}
                fill="none"
                stroke="var(--curve)"
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
              {visibleTurns.map((e) => {
                const cx = x(e.t);
                const cy = yTide(e.height);
                const anchor =
                  cx < PAD_L + 44 ? 'start' : cx > width - PAD_R - 44 ? 'end' : 'middle';
                return (
                  <g key={e.t}>
                    <circle cx={cx} cy={cy} r={3} fill="var(--curve)" />
                    <text
                      x={cx}
                      y={e.kind === 'high' ? cy - 9 : cy + 16}
                      fill="var(--dim)"
                      fontSize={11}
                      fontFamily="var(--cond)"
                      textAnchor={anchor}
                    >
                      {e.kind === 'high' ? 'H' : 'L'} {epochToSpotTime(e.t, utcOffsetSeconds)}
                    </text>
                  </g>
                );
              })}
              {label(topTide, 'Tide', 'm')}
            </>
          )}

          {/* ---- wind ---- */}
          <line
            x1={PAD_L}
            y1={yWind(CUTOFF_KN)}
            x2={width - PAD_R}
            y2={yWind(CUTOFF_KN)}
            stroke="var(--gust)"
            strokeWidth={1}
            strokeDasharray="3 4"
            opacity={0.65}
          />
          <text
            x={width - PAD_R}
            y={yWind(CUTOFF_KN) - 5}
            fill="var(--dim)"
            fontSize={10}
            fontFamily="var(--cond)"
            textAnchor="end"
          >
            {CUTOFF_KN} kn
          </text>
          <path
            d={trace((p) => p.windGust, yWind)}
            fill="none"
            stroke="var(--gust)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <path
            d={trace((p) => p.windSpeed, yWind)}
            fill="none"
            stroke="var(--curve)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {label(topWind, 'Wind', 'kn')}

          {/* ---- rain ---- */}
          <line
            x1={PAD_L}
            y1={rainBase}
            x2={width - PAD_R}
            y2={rainBase}
            stroke="var(--rule)"
            strokeWidth={1}
          />
          {slice.map((p) => {
            if (!p.precip || p.precip <= 0) return null;
            const barW = Math.max(2, (inner / slice.length) * 0.55);
            return (
              <rect
                key={p.t}
                x={x(p.t) - barW / 2}
                y={yRain(p.precip)}
                width={barW}
                height={Math.max(1, rainBase - yRain(p.precip))}
                fill="var(--curve)"
                opacity={0.85}
              />
            );
          })}
          {label(topRain, 'Rain', 'mm')}

          {/* ---- axis ---- */}
          {/* Two days at three-hourly ticks is sixteen labels, which fit a
              desktop column and turn to mush on a phone. Thin them to whatever
              the measured width can actually hold. */}
          {ticks
            .filter((_, i) => i % Math.max(1, Math.ceil((ticks.length * 54) / inner)) === 0)
            .map((tick) => (
              <text
                key={tick.t}
                x={x(tick.t)}
                y={height - 8}
                fill="var(--dim)"
                fontSize={11}
                fontFamily="var(--cond)"
                textAnchor="middle"
              >
                {epochToSpotTime(tick.t, utcOffsetSeconds)}
              </text>
            ))}

          {/* ---- the two rules that cross every panel ---- */}
          {cursorT !== null && (
            <line
              x1={x(cursorT)}
              y1={bandTop}
              x2={x(cursorT)}
              y2={rainBase}
              stroke="var(--dim)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
          <line
            x1={x(now)}
            y1={bandTop}
            x2={x(now)}
            y2={rainBase}
            stroke="var(--accent)"
            strokeWidth={2.5}
          />
        </svg>
      )}
    </div>
  );
}
