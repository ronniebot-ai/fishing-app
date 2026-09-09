import { useRef, useState } from 'react';
import type { TimelinePoint } from '../api/types';
import { epochToSpotTime, toCompass } from '../domain/units';
import { useElementWidth } from '../hooks/useElementWidth';

const WIND_H = 132;
const RAIN_H = 62;
const PAD = 16;
const HOUR = 3600_000;

/** Above this most shore and small-boat fishing stops. */
const CUTOFF_KN = 25;

interface WindRainChartProps {
  points: TimelinePoint[];
  utcOffsetSeconds: number;
  now: number;
  hours?: number;
}

/**
 * Wind and rain as two plots over a shared time axis.
 *
 * Knots and millimetres are different quantities on different scales. A single
 * frame with two y-axes would invite the reader to compare crossings that mean
 * nothing, so they get separate drawings that line up in x.
 */
export function WindRainChart({
  points,
  utcOffsetSeconds,
  now,
  hours = 48,
}: WindRainChartProps) {
  const holder = useRef<HTMLDivElement>(null);
  const width = useElementWidth(holder);
  const [hover, setHover] = useState<{ x: number; p: TimelinePoint } | null>(null);

  const slice = points.filter((p) => p.t >= now - HOUR && p.t <= now + hours * HOUR);
  if (slice.length < 3) return null;

  const t0 = slice[0].t;
  const t1 = slice[slice.length - 1].t;
  const span = Math.max(t1 - t0, HOUR);
  const x = (t: number) => ((t - t0) / span) * width;

  const speeds = slice.flatMap((p) =>
    [p.windSpeed, p.windGust].filter((v): v is number => v !== null),
  );
  const maxKn = Math.max(CUTOFF_KN + 6, Math.ceil(Math.max(0, ...speeds) / 5) * 5);
  const wy = (v: number) => PAD + ((maxKn - v) / maxKn) * (WIND_H - PAD * 2);

  const rains = slice.map((p) => p.precip ?? 0);
  const maxRain = Math.max(1, Math.ceil(Math.max(...rains) * 2) / 2);
  const hasRain = rains.some((v) => v > 0);

  function series(pick: (p: TimelinePoint) => number | null) {
    let d = '';
    let open = false;
    for (const p of slice) {
      const v = pick(p);
      if (v === null) {
        open = false;
        continue;
      }
      d += `${open ? 'L' : 'M'}${x(p.t).toFixed(1)},${wy(v).toFixed(1)} `;
      open = true;
    }
    return d;
  }

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - rect.left) / Math.max(width, 1)) * span;
    let best = slice[0];
    for (const p of slice) {
      if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    }
    setHover({ x: x(best.t), p: best });
  }

  const barW = Math.max(1.5, (width / slice.length) * 0.62);

  return (
    <div className="chart-holder" ref={holder}>
      {width > 0 && (
        <>
          <svg
            width={width}
            height={WIND_H}
            role="img"
            aria-label={`Wind speed and gusts in knots over the next ${hours} hours`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            <line
              x1={0}
              y1={wy(CUTOFF_KN)}
              x2={width}
              y2={wy(CUTOFF_KN)}
              stroke="var(--gust)"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.6}
            />
            <text
              x={width}
              y={wy(CUTOFF_KN) - 5}
              textAnchor="end"
              fill="var(--dim)"
              fontSize={10.5}
              fontFamily="var(--cond)"
            >
              {CUTOFF_KN} kn
            </text>

            <path
              d={series((p) => p.windGust)}
              fill="none"
              stroke="var(--gust)"
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <path
              d={series((p) => p.windSpeed)}
              fill="none"
              stroke="var(--curve)"
              strokeWidth={2}
              strokeLinejoin="round"
            />

            {hover && (
              <line
                x1={hover.x}
                y1={PAD - 6}
                x2={hover.x}
                y2={WIND_H - PAD + 6}
                stroke="var(--dim)"
                strokeWidth={1}
              />
            )}
            <line
              x1={x(now)}
              y1={PAD - 6}
              x2={x(now)}
              y2={WIND_H - PAD + 6}
              stroke="var(--accent)"
              strokeWidth={2.5}
            />
          </svg>

          <svg
            width={width}
            height={RAIN_H}
            role="img"
            aria-label={`Hourly rainfall in millimetres over the next ${hours} hours`}
          >
            <line
              x1={0}
              y1={RAIN_H - 8}
              x2={width}
              y2={RAIN_H - 8}
              stroke="var(--rule)"
              strokeWidth={1}
            />
            {hasRain ? (
              slice.map((p) => {
                const v = p.precip ?? 0;
                if (v <= 0) return null;
                const h = (v / maxRain) * (RAIN_H - 20);
                return (
                  <rect
                    key={p.t}
                    x={x(p.t) - barW / 2}
                    y={RAIN_H - 8 - h}
                    width={barW}
                    height={h}
                    fill="var(--curve)"
                    opacity={0.85}
                  />
                );
              })
            ) : (
              <text
                x={0}
                y={RAIN_H - 20}
                fill="var(--dim)"
                fontSize={12.5}
                fontFamily="var(--sans)"
              >
                No rain forecast
              </text>
            )}
          </svg>
        </>
      )}

      {hover && (
        <div
          className="tip"
          style={{
            left: Math.min(Math.max(hover.x + 10, 0), Math.max(width - 150, 0)),
            top: 4,
          }}
        >
          <div className="t">{epochToSpotTime(hover.p.t, utcOffsetSeconds)}</div>
          <div className="r">
            <span>Wind</span>
            <b>
              {hover.p.windSpeed === null
                ? '—'
                : `${Math.round(hover.p.windSpeed)} kn ${toCompass(hover.p.windDir)}`}
            </b>
          </div>
          <div className="r">
            <span>Gusts</span>
            <b>{hover.p.windGust === null ? '—' : `${Math.round(hover.p.windGust)} kn`}</b>
          </div>
          <div className="r">
            <span>Rain</span>
            <b>{hover.p.precip === null ? '—' : `${hover.p.precip.toFixed(1)} mm`}</b>
          </div>
        </div>
      )}
    </div>
  );
}
