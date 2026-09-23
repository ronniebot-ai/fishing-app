import type { Meta, StoryObj } from '@storybook/react-vite';
import { extremes, NOW, sunrises, sunsets, SYDNEY_UTC_OFFSET, timeline } from '../fixtures/conditions';
import { Spine } from './Spine';

/**
 * Tide, wind and rain on one axis.
 *
 * It measures its own container and draws at true pixel dimensions, so resize
 * the canvas rather than zooming it — a zoom scales the type along with the
 * curves and hides exactly the crowding this drawing is prone to.
 *
 * The night bands are the thing to watch when changing anything here: they
 * have to run the full height of all three panels, because that is the claim
 * the shared axis is making — dawn reaches tide, wind and rain at once.
 */
const meta = {
  title: 'Instrument/Spine',
  component: Spine,
  args: {
    points: timeline,
    extremes,
    sunrises,
    sunsets,
    utcOffsetSeconds: SYDNEY_UTC_OFFSET,
    now: NOW,
  },
} satisfies Meta<typeof Spine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A short horizon crowds the turn labels together — the usual failure mode. */
export const ShortHorizon: Story = {
  args: { hours: 12 },
};

/**
 * Inland, where the marine model has nothing. Wind and rain still reach the
 * spot, so the tide panel is dropped and the other two close the gap rather
 * than the whole drawing disappearing.
 */
export const NoMarineData: Story = {
  args: {
    points: timeline.map((p) => ({ ...p, tideHeight: null, tideRate: null })),
    extremes: [],
  },
};

/** A blown-out day: gusts through the 25-knot rule the wind panel draws. */
export const BlownOut: Story = {
  args: {
    points: timeline.map((p) => ({
      ...p,
      windSpeed: (p.windSpeed ?? 0) + 16,
      windGust: (p.windGust ?? 0) + 20,
    })),
  },
};
