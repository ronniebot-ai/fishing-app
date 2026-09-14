import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { savedSpots } from '../fixtures/spots';
import { SpotMap } from './SpotMap';

/**
 * The picker.
 *
 * Leaflet sizes itself from its container, so these stories opt out of the
 * `.instrument` wrapper and supply the map rail's own full-height box
 * instead. Without an explicit height the map collapses to nothing.
 */
const meta = {
  title: 'Instrument/SpotMap',
  component: SpotMap,
  parameters: { bare: true },
  decorators: [
    (Story) => (
      <div className="map-rail" style={{ height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
  args: { onPick: fn(), onSelectSaved: fn(), saved: [], focus: null },
} satisfies Meta<typeof SpotMap>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing picked yet: the whole mainland, framed. */
export const Empty: Story = {
  args: { selected: null, anchor: null },
};

export const SpotPicked: Story = {
  args: { selected: { lat: -33.89, lon: 151.274 }, anchor: null },
};

/**
 * The spot is inshore and the wave model's nearest cell is well out to sea.
 * The ringed mark is what the caveat above the verdict refers to, so it has
 * to be findable without the copy pointing at it.
 */
export const WithDistantAnchor: Story = {
  args: {
    selected: { lat: -33.89, lon: 151.19 },
    anchor: { lat: -33.92, lon: 151.36 },
  },
};

/**
 * Kept spots alongside the picked one. Three marks are on this map and each
 * has to say something different at a glance: the hot pin is where the
 * readings are from, the hollow pink rings are places to come back to, and
 * the teal ring is the model cell. Worth checking on both palettes.
 */
export const WithSavedSpots: Story = {
  args: {
    selected: { lat: savedSpots[0].lat, lon: savedSpots[0].lon },
    anchor: null,
    saved: savedSpots,
  },
};
