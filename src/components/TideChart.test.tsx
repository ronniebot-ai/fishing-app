/**
 * The tide chart draws at true pixel dimensions rather than scaling a viewBox,
 * so it paints nothing until its container has been measured. jsdom lays
 * nothing out, which makes the measurement the thing these tests have to fake
 * — and makes "did it skip the first paint correctly?" worth asserting.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extremes, NOW, SYDNEY_UTC_OFFSET, timeline, windows } from '../fixtures/conditions';
import { flushResizeObservers } from '../test/setup';
import { TideChart } from './TideChart';

/** Give every element a laid-out width, the way a browser would. */
function stubWidth(px: number) {
  return vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockReturnValue({ width: px, height: 150, x: 0, y: 0, top: 0, left: 0, right: px, bottom: 150, toJSON: () => ({}) } as DOMRect);
}

afterEach(() => vi.restoreAllMocks());

function renderChart(props: Partial<Parameters<typeof TideChart>[0]> = {}) {
  return render(
    <TideChart
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

describe('TideChart', () => {
  it('draws nothing until the container has been measured', () => {
    // No width stub: jsdom reports 0, as a browser does before layout.
    renderChart();

    expect(chart()).not.toBeInTheDocument();
  });

  it('draws once a width is available, and describes itself', () => {
    stubWidth(720);
    renderChart();

    expect(chart()).toHaveAccessibleName(/tide height over the next two days/i);
    expect(chart()).toHaveAttribute('width', '720');
  });

  it('shades the fishable windows behind the curve', () => {
    stubWidth(720);
    const { container } = renderChart();

    // The shading is the chart's whole argument — the curve alone does not
    // say which hours are worth going.
    const shaded = container.querySelectorAll('rect[fill="var(--wash)"]');
    expect(shaded).toHaveLength(windows.length);
  });

  it('redraws at the new width when the container resizes', () => {
    stubWidth(720);
    renderChart();
    expect(chart()).toHaveAttribute('width', '720');

    stubWidth(360);
    act(() => flushResizeObservers());

    expect(chart()).toHaveAttribute('width', '360');
  });

  it('bails out rather than framing an empty plot with no tide data', () => {
    stubWidth(720);
    renderChart({
      points: timeline.map((p) => ({ ...p, tideHeight: null, tideRate: null })),
      extremes: [],
      windows: [],
    });

    expect(chart()).not.toBeInTheDocument();
  });
});
