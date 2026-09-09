import { useRef, useState } from 'react';
import type { TimelinePoint } from '../api/types';
import type { FishingWindow } from '../domain/score';
import type { TideExtreme } from '../domain/tides';
import { epochToSpotTime } from '../domain/units';
import { useElementWidth } from '../hooks/useElementWidth';

const HEIGHT = 208;
const PAD_T = 26;
const PAD_B = 30;
const HOUR = 3600_000;

interface TideChartProps {
  points: TimelinePoint[];
  extremes: TideExtreme[];
  windows: FishingWindow[];
  utcOffsetSeconds: number;
  now: number;
  hours?: number;
}

/**
 * The hero: tide height with the fishable hours shaded straight onto it.
 *
 * Drawn by hand rather than through a chart library. The marks here are
 * specific — shaded windows behind the curve, midnight rules, interpolated
 * turns labelled in place, one magenta line for now — and at true pixel
 * scale, so nothing is distorted by a stretched viewBox.
 */
export function TideChart({
  points,
  extremes,
  windows,
  utcOffsetSeconds,
  now,
  hours = 48,
}: TideChartProps) {
  const holder = useRef<HTMLDivElement>(null);
  const width = useElementWidth(holder);
  const [hover, setHover] = useState<{ x: number; p: TimelinePoint } | null>(null);

  const slice = points.filter((p) => p.t >= now - HOUR && p.t <= now + hours * HOUR);
  const usable = slice.filter((p) => p.tideHeight !== null);

  if (usable.length < 3) return null;

  const t0 = slice[0].t;
  const t1 = slice[slice.length - 1].t;
  const span = Math.max(t1 - t0, HOUR);

  const heights = usable.map((p) => p.tideHeight!);
  const lo = Math.min(...heights);
  const hi = Math.max(...heights);
  // Headroom so the H/L labels sit clear of the drawing's edges.
  const min = lo - (hi - lo) * 0.22 - 0.05;
  const max = hi + (hi - lo) * 0.22 + 0.05;

  const x = (t: number) => ((t - t0) / span) * width;
  const y = (h: number) => PAD_T + ((max - h) / (max - min)) * (HEIGHT - PAD_T - PAD_B);

  // Build the curve from the real hourly samples, breaking at gaps.
  let line = '';
  let open = false;
  for (const p of slice) {
    if (p.tideHeight === null) {
      open = false;
      continue;
    }
    line += `${open ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.tideHeight).toFixed(1)} `;
    open = true;
  }

  const baseline = HEIGHT - PAD_B;
  const firstX = x(usable[0].t);
  const lastX = x(usable[usable.length - 1].t);
  const areaPath = `${line}L${lastX.toFixed(1)},${baseline} L${firstX.toFixed(1)},${baseline} Z`;

  const visibleTurns = extremes.filter((e) => e.t >= t0 && e.t <= t1);

  // Local midnights, for the only vertical structure the reader needs.
  const midnights: number[] = [];
  const first = new Date(t0 + utcOffsetSeconds * 1000);
  const startOfDay = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
  for (let d = 1; d <= 3; d++) {
    const mid = startOfDay + d * 86_400_000 - utcOffsetSeconds * 1000;
    if (mid > t0 && mid < t1) midnights.push(mid);
  }

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = t0 + (px / Math.max(width, 1)) * span;
    let best = usable[0];
    for (const p of usable) {
      if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    }
    setHover({ x: x(best.t), p: best });
  }

  return (
    <div className="chart-holder" ref={holder}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label="Tide height over the next two days, with the hours worth fishing shaded"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {windows.map((w) => (
            <rect
              key={w.startT}
              x={x(Math.max(w.startT, t0))}
              y={PAD_T - 6}
              width={Math.max(0, x(Math.min(w.endT, t1)) - x(Math.max(w.startT, t0)))}
              height={HEIGHT - PAD_T - PAD_B + 6}
              fill="var(--wash)"
            />
          ))}

          {midnights.map((m) => (
            <line
              key={m}
              x1={x(m)}
              y1={PAD_T - 6}
              x2={x(m)}
              y2={baseline}
              stroke="var(--rule)"
              strokeWidth={1}
              strokeDasharray="2 4"
            />
          ))}

          {/* Mean sea level */}
          <line x1={0} y1={y(0)} x2={width} y2={y(0)} stroke="var(--rule)" strokeWidth={1} />

          <path d={areaPath} fill="var(--curve-fill)" stroke="none" />
          <path
            d={line}
            fill="none"
            stroke="var(--curve)"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />

          {visibleTurns.map((e) => {
            const cx = x(e.t);
            const cy = y(e.height);
            const high = e.kind === 'high';
            // Keep the label inside the drawing at both ends.
            const anchor = cx < 42 ? 'start' : cx > width - 42 ? 'end' : 'middle';
            const lx = anchor === 'start' ? 0 : anchor === 'end' ? width : cx;
            return (
              <g key={e.t}>
                <circle cx={cx} cy={cy} r={3} fill="var(--curve)" />
                <text
                  x={lx}
                  y={high ? cy - 10 : cy + 19}
                  textAnchor={anchor}
                  fill="var(--dim)"
                  fontSize={11}
                  fontFamily="var(--cond)"
                >
                  {high ? 'H' : 'L'} {epochToSpotTime(e.t, utcOffsetSeconds)}
                </text>
              </g>
            );
          })}

          {hover && (
            <line
              x1={hover.x}
              y1={PAD_T - 6}
              x2={hover.x}
              y2={baseline}
              stroke="var(--dim)"
              strokeWidth={1}
            />
          )}

          {/* Now: the single hot mark in the drawing. */}
          <line
            x1={x(now)}
            y1={PAD_T - 6}
            x2={x(now)}
            y2={baseline}
            stroke="var(--accent)"
            strokeWidth={2.5}
          />
        </svg>
      )}

      {hover && hover.p.tideHeight !== null && (
        <div
          className="tip"
          style={{
            left: Math.min(Math.max(hover.x + 10, 0), Math.max(width - 132, 0)),
            top: 4,
          }}
        >
          <div className="t">{epochToSpotTime(hover.p.t, utcOffsetSeconds)}</div>
          <div className="r">
            <span>Tide</span>
            <b>
              {hover.p.tideHeight > 0 ? '+' : ''}
              {hover.p.tideHeight.toFixed(2)} m
            </b>
          </div>
        </div>
      )}
    </div>
  );
}
