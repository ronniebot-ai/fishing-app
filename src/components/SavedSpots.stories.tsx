import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { savedSpots } from '../fixtures/spots';
import { SavedSpots } from './SavedSpots';

/**
 * The kept spots.
 *
 * The list is capped in height and scrolls, because it sits above the verdict
 * and the readings are what the pane is for — worth checking the Many story
 * to see that the cap holds rather than the list running the page long.
 */
const meta = {
  title: 'Instrument/SavedSpots',
  component: SavedSpots,
  args: {
    spots: savedSpots,
    selected: null,
    onSelect: fn(),
    onRename: fn(),
    onRemove: fn(),
  },
} satisfies Meta<typeof SavedSpots>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Library: Story = {};

/** The spot being read takes the annotation colour, matching its map pin. */
export const OneIsCurrent: Story = {
  args: { selected: { lat: savedSpots[2].lat, lon: savedSpots[2].lon } },
};

/** A long name has to truncate rather than push the coordinates off the row. */
export const LongName: Story = {
  args: {
    spots: [
      {
        ...savedSpots[0],
        name: 'The deep hole past the second bommie, north side of the breakwall',
      },
      ...savedSpots.slice(1),
    ],
  },
};

/** Past the cap, where the list starts scrolling inside itself. */
export const Many: Story = {
  args: {
    spots: Array.from({ length: 12 }, (_, i) => ({
      // Shaped like the ObjectId hex the store hands out.
      id: `65f0a1b2c3d4e5f6000000${String(i + 1).padStart(2, '0')}`,
      name: i % 3 === 0 ? `Spot ${i + 1}` : `Ledge ${i + 1}`,
      lat: -33.8 - i * 0.05,
      lon: 151.27 + i * 0.01,
      createdAt: 1_757_000_000_000 + i * 1000,
    })),
  },
};

/** Nothing kept yet: the section is absent, not empty. */
export const Empty: Story = {
  args: { spots: [] },
};
