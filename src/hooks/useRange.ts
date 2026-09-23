import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_RANGE, parseRange, type RangeKey } from '../domain/range';

const STORAGE_KEY = 'tideline-range';

// Same shape as useAuth.ts: `localStorage` fires no event for a write made in
// the tab that reads it, so `set` notifies this by hand.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): RangeKey {
  return parseRange(localStorage.getItem(STORAGE_KEY));
}

/** The server has no localStorage, so it renders the default and hydration
 *  corrects it — the same trade the login state already makes. */
function getServerSnapshot(): RangeKey {
  return DEFAULT_RANGE;
}

export interface Range {
  range: RangeKey;
  setRange: (next: RangeKey) => void;
}

/**
 * How wide a window the spine draws, remembered across visits.
 *
 * A preference rather than a view of this spot, so it lives in the browser
 * and not in the URL: a shared link should open on the reader's own habit,
 * not on the sender's.
 */
export function useRange(): Range {
  const range = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setRange = useCallback((next: RangeKey) => {
    localStorage.setItem(STORAGE_KEY, next);
    for (const listener of listeners) listener();
  }, []);

  return { range, setRange };
}
