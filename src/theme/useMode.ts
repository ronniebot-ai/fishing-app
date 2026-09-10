import { useEffect, useSyncExternalStore } from 'react';
import { applyCssVars } from './antdTheme';
import type { Mode } from './palette';

/**
 * jsdom has no `matchMedia`, and neither does a page in some hosts before
 * hydration. Everything below degrades to "dark", which is the app's primary
 * palette, rather than throwing.
 */
function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-color-scheme: light)');
}

function subscribe(onChange: () => void): () => void {
  const mq = query();
  if (!mq) return () => {};
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/**
 * The app's colour mode, following the operating system.
 *
 * Whatever it resolves to is published twice, because the two halves of the
 * interface read colour differently and neither can see the other's: it is
 * stamped on `<html>` as `data-theme`, which the Leaflet tile filters in
 * index.css key off and cannot read from JS, and pushed onto `:root` as custom
 * properties for the SVG charts and every hand-written rule. antd is fed from
 * the same palette through `buildTheme`.
 */
export function useMode(): Mode {
  const prefersLight = useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? false,
    () => false,
  );
  const mode: Mode = prefersLight ? 'light' : 'dark';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    applyCssVars(mode);
  }, [mode]);

  return mode;
}
