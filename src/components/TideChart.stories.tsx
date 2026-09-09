import type { Meta, StoryObj } from '@storybook/react-vite';
import { extremes, NOW, SYDNEY_UTC_OFFSET, timeline, windows } from '../fixtures/conditions';
import { TideChart } from './TideChart';

/**
 * The hero chart.
 *
 * It measures its own container and draws at true pixel dimensions, so resize
 * the canvas rather than zooming it — a zoom scales the type along with the
 * curve and hides exactly the crowding this chart is prone to.
 */
const meta = {
  title: 'Instrument/TideChart',
  component: TideChart,
  args: {
    points: timeline,
    extremes,
    windows,
    utcOffsetSeconds: SYDNEY_UTC_OFFSET,
    now: NOW,
  },
} satisfies Meta<typeof TideChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A short horizon crowds the turn labels together — the usual failure mode. */
export const ShortHorizon: Story = {
  args: { hours: 12 },
};

/**
 * Inland, where the marine model has nothing: no curve, no turns, no shading.
 * The chart has to degrade to something rather than draw an empty frame.
 */
export const NoMarineData: Story = {
  args: {
    points: timeline.map((p) => ({ ...p, tideHeight: null, tideRate: null })),
    extremes: [],
    windows: [],
  },
};
