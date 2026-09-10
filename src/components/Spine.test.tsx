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
import { extremes, NOW, SYDNEY_UTC_OFFSET, timeline, windows } from '../fixtures/conditions';
import { flushResizeObservers } from '../test/setup';
import { Spine } from './Spine';

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
      windows={windows}
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

    expect(chart()).toHaveAccessibleName(/tide, wind and rain over the next 48 hours/i);
    expect(chart()).toHaveAttribute('width', '720');
  });

  it('runs each fishable window through every panel, not just the tide', () => {
    stubWidth(720);
    const { container } = renderSpine();

    const bands = container.querySelectorAll<SVGRectElement>('rect[fill="var(--wash)"]');
    expect(bands).toHaveLength(windows.length);

    // The whole argument for one shared axis: a band has to be tall enough to
    // cross the tide, wind and rain panels together. Anything around the tide
    // panel's own height would mean the panels had drifted apart again.
    const height = Number(bands[0].getAttribute('height'));
    expect(height).toBeGreaterThan(130 + 88);
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
      windows: [],
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
});
