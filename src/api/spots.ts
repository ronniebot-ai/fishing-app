import { request } from './request';
import type { LatLon } from './types';

/**
 * A spot the user chose to keep.
 *
 * Saving is deliberate: clicking around the map picks a spot to read, and only
 * pressing Save puts one in here.
 */
export interface SavedSpot extends LatLon {
  /** The hex form of the store's ObjectId. Opaque to the app. */
  id: string;
  name: string;
  /** Epoch ms, used only to keep the list in the order they were saved. */
  createdAt: number;
}

export function listSpots(signal?: AbortSignal): Promise<SavedSpot[]> {
  return request<SavedSpot[]>('/api/spots', { signal });
}

/** Omit `name` to have the server number it: "Spot 1", "Spot 2", ... */
export function createSpot(spot: LatLon, name?: string): Promise<SavedSpot> {
  return request<SavedSpot>('/api/spots', {
    method: 'POST',
    body: JSON.stringify({ ...spot, name }),
  });
}

export function renameSpot(id: string, name: string): Promise<SavedSpot> {
  return request<SavedSpot>(`/api/spots/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export function deleteSpot(id: string): Promise<void> {
  return request<void>(`/api/spots/${id}`, { method: 'DELETE' });
}

/** The saved spot at these coordinates, if this one has been kept. */
export function findSaved(spots: SavedSpot[], at: LatLon | null): SavedSpot | null {
  if (!at) return null;
  return spots.find((s) => s.lat === at.lat && s.lon === at.lon) ?? null;
}

/** Matches NAME_MAX on the server, so the input stops where the store does. */
export const SPOT_NAME_MAX = 60;
