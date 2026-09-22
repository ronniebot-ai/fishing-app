import type { Meta, StoryObj } from '@storybook/react-vite';
import type { NearbySpot, SpotStats as Stats } from '../api/stats';
import { SpotStats } from './SpotStats';

/**
 * The block that answers "what is this place like" rather than "what is it
 * doing this weekend".
 *
 * Worth looking at in both palettes: the hour strip is drawn entirely in the
 * tone colours, which are defined separately for dark and daylight, and a bar
 * for an hour with nothing kept has to stay distinguishable from a bar for an
 * hour that simply scored zero.
 */
const meta = {
  title: 'Instrument/SpotStats',
  component: SpotStats,
  args: { km: 25, onSelect: () => {} },
} satisfies Meta<typeof SpotStats>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A dawn spot: the strip should lean hard to the left. */
function dawnSpot(): Stats {
  const shape = [
    25, 22, 28, 40, 62, 84, 91, 88, 70, 55, 44, 38, 35, 33, 36, 42, 51, 58, 49, 38, 31, 28, 26, 24,
  ];
  return {
    samples: 1_412,
    days: 30,
    byHour: shape.map((avgScore, hour) => ({
      hour,
      avgScore,
      bestScore: Math.min(100, avgScore + 12),
      samples: 58 + (hour % 5),
    })),
    distribution: [
      { from: 0, to: 19, samples: 90 },
      { from: 20, to: 39, samples: 410 },
      { from: 40, to: 59, samples: 502 },
      { from: 60, to: 79, samples: 320 },
      { from: 80, to: 100, samples: 90 },
    ],
    factors: { tide: 0.61, wind: 0.54, wave: 0.7, rain: 0.92 },
    unfishableShare: 0.06,
  };
}

const nearby: NearbySpot[] = [
  { id: '1'.repeat(24), name: 'South end, off the rocks', lat: -33.8908, lon: 151.2743, distanceM: 0, nextAt: null, nextScore: 78 },
  { id: '2'.repeat(24), name: 'The wall', lat: -33.9806, lon: 151.2264, distanceM: 840, nextAt: null, nextScore: 41 },
  { id: '3'.repeat(24), name: 'Spot 4', lat: -33.7969, lon: 151.2873, distanceM: 10_480, nextAt: null, nextScore: null },
];

export const WithHistory: Story = {
  args: { stats: dawnSpot(), nearby },
};

/** A saved spot opened for the first time: nothing kept, but the block exists. */
export const NothingKeptYet: Story = {
  args: {
    stats: { samples: 0, days: 30, byHour: [], distribution: [], factors: null, unfishableShare: 0 },
    nearby: [],
  },
};

/** Hours missing from the middle of the day, which must not read as calm. */
export const Patchy: Story = {
  args: {
    stats: { ...dawnSpot(), samples: 210, byHour: dawnSpot().byHour.filter((h) => h.hour < 9) },
    nearby: [],
  },
};

/** An unsaved point on the map: no history of its own, but neighbours. */
export const NearbyOnly: Story = {
  args: { stats: null, nearby },
};
