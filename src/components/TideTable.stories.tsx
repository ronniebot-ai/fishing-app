import type { Meta, StoryObj } from '@storybook/react-vite';
import { extremes, NOW, SYDNEY_UTC_OFFSET } from '../fixtures/conditions';
import { TideTable } from './TideTable';

const meta = {
  title: 'Instrument/TideTable',
  component: TideTable,
  args: { extremes, utcOffsetSeconds: SYDNEY_UTC_OFFSET, now: NOW },
} satisfies Meta<typeof TideTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Inland: no turns to list at all. */
export const NoTides: Story = {
  args: { extremes: [] },
};
