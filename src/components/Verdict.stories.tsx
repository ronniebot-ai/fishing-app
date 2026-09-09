import type { Meta, StoryObj } from '@storybook/react-vite';
import { gatedScore, roughScore, score } from '../fixtures/conditions';
import { Verdict } from './Verdict';

/**
 * The headline call. Worth flipping between the palettes on each of these —
 * the tone colours carry the whole message and they are defined separately
 * for dark and daylight.
 */
const meta = {
  title: 'Instrument/Verdict',
  component: Verdict,
} satisfies Meta<typeof Verdict>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Prime: Story = {
  args: {
    score,
    summary: 'Tide coming in, a light south-easterly, small swell. Worth going.',
  },
};

export const Fair: Story = {
  args: {
    score: roughScore,
    summary: 'Tide running out, a fresh south-easterly and a two-metre swell.',
  },
};

/** A hard gate: the score stops being the point and the warning takes over. */
export const Unfishable: Story = {
  args: {
    score: gatedScore,
    summary: 'Gale-force south-easterly with a heavy sea running.',
  },
};
