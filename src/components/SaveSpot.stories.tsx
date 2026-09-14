import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { savedSpots } from '../fixtures/spots';
import { SaveSpot } from './SaveSpot';

/**
 * Keeping a spot.
 *
 * This is the app's first text input, so it is worth flipping the palette on
 * these: the field has to read as an editable surface against both grounds
 * without borrowing a shadow or a radius from somewhere else.
 */
const meta = {
  title: 'Instrument/SaveSpot',
  component: SaveSpot,
  args: {
    spot: { lat: -33.8908, lon: 151.2743 },
    saved: null,
    saving: false,
    error: null,
    onSave: fn(),
  },
} satisfies Meta<typeof SaveSpot>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The ordinary case: a spot just picked, not yet named or kept. */
export const Unsaved: Story = {};

export const Saving: Story = {
  args: { saving: true },
};

/** Already in the library, so there is nothing to press. */
export const AlreadyKept: Story = {
  args: { saved: savedSpots[2] },
};

/**
 * The one refusal the user will actually meet: pressing Save on a spot that
 * is already kept under another name.
 */
export const Refused: Story = {
  args: { error: new Error('Already saved as The wall.') },
};
