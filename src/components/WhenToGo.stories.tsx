import type { Meta, StoryObj } from '@storybook/react-vite';
import { NOW, SYDNEY_UTC_OFFSET, windows } from '../fixtures/conditions';
import { WhenToGo } from './WhenToGo';

const meta = {
  title: 'Instrument/WhenToGo',
  component: WhenToGo,
  args: { utcOffsetSeconds: SYDNEY_UTC_OFFSET, now: NOW },
} satisfies Meta<typeof WhenToGo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three ranked windows, the live one picked out. */
export const Ranked: Story = {
  args: { windows },
};

/** The clock sits before every window, so no row is marked "Now". */
export const NothingRunningYet: Story = {
  args: { windows, now: windows[2].startT - 3_600_000 },
};

/** Two days of weather against you — the empty state has to say why. */
export const NothingWorthGoing: Story = {
  args: { windows: [] },
};
