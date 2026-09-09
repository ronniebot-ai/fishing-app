import type { Meta, StoryObj } from '@storybook/react-vite';
import { NOW, SYDNEY_UTC_OFFSET, timeline } from '../fixtures/conditions';
import { WindRainChart } from './WindRainChart';

const meta = {
  title: 'Instrument/WindRainChart',
  component: WindRainChart,
  args: { points: timeline, utcOffsetSeconds: SYDNEY_UTC_OFFSET, now: NOW },
} satisfies Meta<typeof WindRainChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * Every hour past the 25-knot rule, which is where most shore fishing stops.
 * The dashed threshold should still be visible rather than pinned to the
 * floor of the plot.
 */
export const Blowing: Story = {
  args: {
    points: timeline.map((p) => ({
      ...p,
      windSpeed: (p.windSpeed ?? 0) + 22,
      windGust: (p.windGust ?? 0) + 28,
    })),
  },
};

/** Wind only — the rain plot has nothing to draw. */
export const NoRainData: Story = {
  args: {
    points: timeline.map((p) => ({ ...p, precip: null, precipProb: null })),
  },
};
