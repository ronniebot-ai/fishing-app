import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  extremes,
  inlandPoint,
  inlandScore,
  nowPoint,
  roughPoint,
  roughScore,
  score,
  SYDNEY_UTC_OFFSET,
} from '../fixtures/conditions';
import { Readout } from './Readout';

/**
 * The four readings.
 *
 * Each row carries a hairline sized to that reading's contribution, so
 * comparing the stories below is the quickest way to see whether the bars
 * still track the numbers beside them.
 */
const meta = {
  title: 'Instrument/Readout',
  component: Readout,
  args: { utcOffsetSeconds: SYDNEY_UTC_OFFSET },
} satisfies Meta<typeof Readout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Coastal: Story = {
  args: { point: nowPoint, score, extremes },
};

/** Windy and rough: the hairlines should visibly shorten. */
export const Rough: Story = {
  args: { point: roughPoint, score: roughScore, extremes },
};

/**
 * Too far from the coast for the wave model. Swell and tide read "inland"
 * rather than "No data" — a missing row and an inapplicable one are different
 * things and should not look alike.
 */
export const Inland: Story = {
  args: { point: inlandPoint, score: inlandScore, extremes: [] },
};
