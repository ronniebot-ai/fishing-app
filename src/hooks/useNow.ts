import { useEffect, useState } from 'react';

/**
 * The current time as state, refreshed on an interval.
 *
 * Reading `Date.now()` during render is impure — React may recompute at any
 * time and the value would drift between components in the same paint. Holding
 * it in state also means the "now" marker, the current-hour score and the
 * 48-hour window actually advance while the page is left open, which matters
 * for something people check before heading out.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
