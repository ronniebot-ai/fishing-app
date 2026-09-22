import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { createSpot, deleteSpot, listSpots, renameSpot, type SavedSpot } from '../api/spots';
import type { LatLon } from '../api/types';

const KEY = ['spots'];

export interface SavedSpots {
  spots: SavedSpot[];
  /**
   * False once a request has failed. The app is publishable as static files
   * with no server behind it, and in that build the whole feature should
   * simply not appear rather than sit there erroring.
   */
  available: boolean;
  saving: boolean;
  /** Why the last save was refused — usually that the spot is already kept. */
  saveError: Error | null;
  save: (spot: LatLon, name?: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

/**
 * The saved-spot library.
 *
 * Every write goes to the server and the list is refetched from it, rather
 * than being patched optimistically: the server owns the numbering of unnamed
 * spots, so it is the only thing that knows what a new spot is called.
 */
export function useSavedSpots(): SavedSpots {
  const client = useQueryClient();

  const list = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => listSpots(signal),
    staleTime: Infinity, // Nothing changes it but this browser.
  });

  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: KEY });
  }, [client]);

  const saveMutation = useMutation({
    mutationFn: ({ spot, name }: { spot: LatLon; name?: string }) => createSpot(spot, name),
    onSuccess: refresh,
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameSpot(id, name),
    onSuccess: refresh,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => deleteSpot(id),
    onSuccess: refresh,
  });

  // `mutate` keeps its identity across renders, so these wrappers only need to
  // be pinned to it rather than to the mutation object, which does not.
  const saveFn = saveMutation.mutate;
  const renameFn = renameMutation.mutate;
  const removeFn = removeMutation.mutate;

  return {
    spots: list.data ?? [],
    available: !list.isError,
    saving: saveMutation.isPending,
    saveError: saveMutation.error,
    save: useCallback((spot: LatLon, name?: string) => saveFn({ spot, name }), [saveFn]),
    rename: useCallback((id: string, name: string) => renameFn({ id, name }), [renameFn]),
    remove: useCallback((id: string) => removeFn(id), [removeFn]),
  };
}
