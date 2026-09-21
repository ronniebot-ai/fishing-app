import type { LatLon } from './types';

/**
 * A spot the user chose to keep.
 *
 * Saving is deliberate: clicking around the map picks a spot to read, and only
 * pressing Save puts one in here.
 */
export interface SavedSpot extends LatLon {
  id: number;
  name: string;
  /** Epoch ms, used only to keep the list in the order they were saved. */
  createdAt: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });

  // DELETE answers 204, which has no body to parse.
  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON — a proxy or a static host answering instead of the API.
  }

  if (!res.ok) {
    // The API reports failures as {error: "..."}, written to be shown as-is.
    const reason = (body as { error?: string } | null)?.error;
    throw new Error(reason ?? `Could not reach the spot list (HTTP ${res.status}).`);
  }
  return body as T;
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

export function renameSpot(id: number, name: string): Promise<SavedSpot> {
  return request<SavedSpot>(`/api/spots/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export function deleteSpot(id: number): Promise<void> {
  return request<void>(`/api/spots/${id}`, { method: 'DELETE' });
}

/** The saved spot at these coordinates, if this one has been kept. */
export function findSaved(spots: SavedSpot[], at: LatLon | null): SavedSpot | null {
  if (!at) return null;
  return spots.find((s) => s.lat === at.lat && s.lon === at.lon) ?? null;
}

/** Matches NAME_MAX on the server, so the input stops where the store does. */
export const SPOT_NAME_MAX = 60;
