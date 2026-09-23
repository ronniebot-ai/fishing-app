/**
 * The spine draws at true pixel dimensions rather than scaling a viewBox, so
 * it paints nothing until its container has been measured. jsdom lays nothing
 * out, which makes the measurement the thing these tests have to fake — and
 * makes "did it skip the first paint correctly?" worth asserting.
 *
 * The rest of the file is about the one claim the drawing makes that three
 * separate charts could not: that a fishable window, the `now` rule and the
 * cursor all mean the same instant in tide, wind and rain at once.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extremes, NOW, sunrises, sunsets, SYDNEY_UTC_OFFSET, timeline } from '../fixtures/conditions';
import { flushResizeObservers } from '../test/setup';
import { Spine } from './Spine';

const HOUR = 3600_000;

/** The fixture day tiled out to a week, for the ranges that span one. */
const week = Array.from({ length: 7 }, (_, d) =>
  timeline.map((p) => ({ ...p, t: p.t + d * 24 * HOUR })),
).flat();

/** Give every element a laid-out width, the way a browser would. */
function stubWidth(px: number) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: px, height: 300, x: 0, y: 0, top: 0, left: 0, right: px, bottom: 300,
    toJSON: () => ({}),
  } as DOMRect);
}

afterEach(() => vi.restoreAllMocks());

function renderSpine(props: Partial<Parameters<typeof Spine>[0]> = {}) {
  return render(
    <Spine
      points={timeline}
      extremes={extremes}
      sunrises={sunrises}
      sunsets={sunsets}
      utcOffsetSeconds={SYDNEY_UTC_OFFSET}
      now={NOW}
      {...props}
    />,
  );
}

const chart = () => screen.queryByRole('img');

describe('Spine', () => {
  it('draws nothing until the container has been measured', () => {
    // No width stub: jsdom reports 0, as a browser does before layout.
    renderSpine();

    expect(chart()).not.toBeInTheDocument();
  });

  it('draws once a width is available, and describes itself', () => {
    stubWidth(720);
    renderSpine();

    expect(chart()).toHaveAccessibleName(/tide, wind and rain over 72 hours/i);
    expect(chart()).toHaveAttribute('width', '720');
  });

  it('runs night through every panel, not just the tide', () => {
    stubWidth(720);
    const { container } = renderSpine();

    const nights = container.querySelectorAll<SVGRectElement>('rect[fill="var(--chart-night)"]');
    // The fixture is one day, opened around 3pm: the window reaches back past
    // the previous sunrise and forward past that evening's sunset, so there is
    // dark at both ends of it.
    expect(nights.length).toBeGreaterThanOrEqual(1);

    // The whole argument for one shared axis: a band has to be tall enough to
    // cross the tide, wind and rain panels together. Anything around the tide
    // panel's own height would mean the panels had drifted apart again.
    const height = Number(nights[0].getAttribute('height'));
    expect(height).toBeGreaterThan(130 + 88);
  });

  it('shades nothing when the model gave no sun times', () => {
    stubWidth(720);
    // An inland probe, or a latitude with no sunset that month. The drawing
    // carries on rather than guessing where the light went.
    const { container } = renderSpine({ sunrises: [], sunsets: [] });

    expect(chart()).toBeInTheDocument();
    expect(container.querySelector('rect[fill="var(--chart-night)"]')).toBeNull();
  });

  it('redraws at the new width when the container resizes', () => {
    stubWidth(720);
    renderSpine();
    expect(chart()).toHaveAttribute('width', '720');

    stubWidth(360);
    act(() => flushResizeObservers());

    expect(chart()).toHaveAttribute('width', '360');
  });

  it('keeps its last width when the container is hidden', () => {
    stubWidth(720);
    renderSpine();

    // A hidden ancestor — a closed tab pane, a collapsed section — reports a
    // zero-width box. That means "not rendered right now", not "zero wide", so
    // the drawing has to survive it rather than blank itself.
    stubWidth(0);
    act(() => flushResizeObservers());

    expect(chart()).toHaveAttribute('width', '720');
  });

  it('drops the tide panel inland instead of drawing nothing at all', () => {
    stubWidth(720);
    const { container } = renderSpine({
      points: timeline.map((p) => ({ ...p, tideHeight: null, tideRate: null })),
      extremes: [],
    });

    // Wind and rain still reach an inland spot, so the drawing stays — it just
    // closes the gap where the tide would have been.
    expect(chart()).toBeInTheDocument();
    expect(container.querySelector('path[stroke="var(--curve-fill)"]')).toBeNull();
    expect(screen.queryByText('MSL')).not.toBeInTheDocument();
    expect(screen.getByText('Wind')).toBeInTheDocument();
  });

  it('reports the hovered hour so the readings above can follow it', () => {
    stubWidth(720);
    const onCursor = vi.fn();
    renderSpine({ onCursor });

    fireEvent.mouseMove(chart()!, { clientX: 360 });

    // Snapped to a real sample: the forecast is hourly, and an interpolated
    // reading would put a number on screen the model never produced.
    const reported = onCursor.mock.calls.at(-1)?.[0];
    expect(timeline.some((p) => p.t === reported)).toBe(true);

    fireEvent.mouseLeave(chart()!);
    expect(onCursor).toHaveBeenLastCalledWith(null);
  });

  it('opens with now a third along when nothing says otherwise', () => {
    stubWidth(720);
    const { container } = renderSpine({ hours: 12 });

    // 12 hours wide, so four back and eight forward.
    const rule = container.querySelector<SVGLineElement>('line[stroke="var(--accent)"]')!;
    const first = timeline.find((p) => p.t >= NOW - 4 * HOUR)!;
    const last = [...timeline].reverse().find((p) => p.t <= NOW + 8 * HOUR)!;
    const share = (NOW - first.t) / (last.t - first.t);

    expect(share).toBeCloseTo(1 / 3, 2);
    expect(Number(rule.getAttribute('x1'))).toBeGreaterThan(0);
  });

  it('draws the window the scrubber asks for rather than one around now', () => {
    stubWidth(720);
    const { container } = renderSpine({ hours: 6, startT: timeline[12].t });

    // The axis is labelled from the slice, so the hours outside it are gone.
    const axis = container.textContent ?? '';
    expect(axis).not.toContain('1:00am');
  });

  it('names the day it covers across the top, without a year', () => {
    stubWidth(720);
    renderSpine();

    const label = screen.getByText('Mon 7 Sep');
    expect(label).toBeInTheDocument();
    expect(label.textContent).not.toMatch(/2026/);
  });

  it('gives a day less of its name the less room it has', () => {
    // A week of days, at three widths. The label drops a piece at a time
    // rather than being truncated into something that reads as a different
    // date — "Mon 7 S" would be worse than "Mon 7".
    const aWeek = { points: week, hours: 168, startT: timeline[0].t };

    stubWidth(1400);
    const wide = renderSpine(aWeek);
    expect(screen.getByText('Mon 7 Sep')).toBeInTheDocument();
    expect(screen.getByText('Sun 13 Sep')).toBeInTheDocument();
    wide.unmount();

    stubWidth(500);
    const middling = renderSpine(aWeek);
    expect(screen.queryByText('Mon 7 Sep')).not.toBeInTheDocument();
    expect(screen.getByText('Mon 7')).toBeInTheDocument();
    middling.unmount();

    stubWidth(360);
    renderSpine(aWeek);
    expect(screen.queryByText('Mon 7')).not.toBeInTheDocument();
    expect(screen.getByText('Mon')).toBeInTheDocument();
  });

  it('drops the now rule once the window is dragged clear of the present', () => {
    stubWidth(720);
    const { container } = renderSpine({ hours: 6, startT: NOW + 4 * HOUR });

    // Better no rule than one pinned to an edge it has nothing to do with.
    expect(container.querySelector('line[stroke="var(--accent)"]')).toBeNull();
  });
});
