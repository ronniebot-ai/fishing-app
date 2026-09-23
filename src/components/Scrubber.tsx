import { useRef } from 'react';
import { epochToSpotTime } from '../domain/units';

const HOUR = 3600_000;

interface ScrubberProps {
  /** The extent of the data behind the chart, not of the chart itself. */
  dataStart: number;
  dataEnd: number;
  /** The left edge of what the spine is drawing, and how wide that is. */
  startT: number;
  hours: number;
  now: number;
  utcOffsetSeconds: number;
  onScrub: (startT: number) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Where the drawn window sits inside the forecast that was fetched.
 *
 * The spine only ever showed the hours either side of now, which was fine
 * while that was the only thing it could show. Once the width is a choice the
 * position has to be one too, and a bar under the chart says both things at
 * once: how much of the whole forecast is on screen, and which part.
 *
 * Deliberately not a scrollbar on the chart itself. The chart already owns
 * the pointer — moving across it moves the readings above — so panning by
 * dragging it would make one gesture mean two things.
 */
export function Scrubber({
  dataStart,
  dataEnd,
  startT,
  hours,
  now,
  utcOffsetSeconds,
  onScrub,
}: ScrubberProps) {
  const track = useRef<HTMLDivElement>(null);
  const grab = useRef(0);

  const span = hours * HOUR;
  const total = Math.max(dataEnd - dataStart, span);
  const maxStart = dataEnd - span;
  const roomy = maxStart > dataStart;

  const pct = (t: number) => ((t - dataStart) / total) * 100;
  const move = (next: number) => onScrub(clamp(next, dataStart, maxStart));

  /** Pointer x as an instant on the track. */
  function instantAt(clientX: number): number {
    const rect = track.current!.getBoundingClientRect();
    return dataStart + ((clientX - rect.left) / Math.max(rect.width, 1)) * total;
  }

  function onTrackDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    // A click on bare track centres the window there, which is what a reader
    // pointing at a day two thirds along almost certainly means.
    move(instantAt(e.clientX) - span / 2);
  }

  function onThumbDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = instantAt(e.clientX) - startT;
  }

  function onThumbMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    move(instantAt(e.clientX) - grab.current);
  }

  function onThumbUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // A quarter of the window per page, an hour per arrow: the arrow is for
    // lining a turn up with an edge, the page for getting somewhere.
    const step =
      e.key === 'ArrowLeft' ? -HOUR
      : e.key === 'ArrowRight' ? HOUR
      : e.key === 'PageUp' ? -span / 4
      : e.key === 'PageDown' ? span / 4
      : 0;

    if (step === 0 && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();

    if (e.key === 'Home') move(dataStart);
    else if (e.key === 'End') move(maxStart);
    else move(startT + step);
  }

  // Nothing to move it to, so nothing to draw. A range that fits its whole
  // reach on screen — a day does — is finished without a bar under it.
  if (!roomy) return null;

  return (
    <div className="scrubber" ref={track} onPointerDown={onTrackDown}>
      {/* Where the present falls in the whole forecast, so the window can be
          put back beside it by eye after a drag. */}
      <span className="scrub-now" style={{ left: `${clamp(pct(now), 0, 100)}%` }} />
      <div
        className="scrub-thumb"
        role="slider"
        tabIndex={0}
        aria-label="Which part of the forecast the chart shows"
        aria-valuemin={dataStart}
        aria-valuemax={maxStart}
        aria-valuenow={startT}
        aria-valuetext={`From ${epochToSpotTime(startT, utcOffsetSeconds)}, ${hours} hours`}
        style={{ left: `${pct(startT)}%`, width: `${(span / total) * 100}%` }}
        onPointerDown={onThumbDown}
        onPointerMove={onThumbMove}
        onPointerUp={onThumbUp}
        onPointerCancel={onThumbUp}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
