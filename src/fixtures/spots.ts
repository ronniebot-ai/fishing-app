import type { SavedSpot } from '../api/spots';

/**
 * A small library, shaped like one that has been used: a couple of spots
 * named by hand and one left with the number the server gave it.
 */
export const savedSpots: SavedSpot[] = [
  { id: '65f0a1b2c3d4e5f600000001', name: 'South Head, off the rocks', lat: -33.8388, lon: 151.2846, createdAt: 1_757_000_000_000 },
  { id: '65f0a1b2c3d4e5f600000002', name: 'Spot 2', lat: -33.8908, lon: 151.2743, createdAt: 1_757_100_000_000 },
  { id: '65f0a1b2c3d4e5f600000003', name: 'The wall', lat: -33.9806, lon: 151.2264, createdAt: 1_757_200_000_000 },
];
