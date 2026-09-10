import { useEffect, useState, type RefObject } from 'react';

/**
 * Track an element's rendered width.
 *
 * The charts draw at true pixel dimensions rather than scaling a fixed
 * viewBox. Stretching a viewBox to fill the width would scale x and y
 * independently and squash every label in the drawing.
 *
 * Returns 0 until the element has been measured, which callers use to skip
 * the first paint rather than drawing at a guessed size.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      // A zero means the element is not being rendered right now — it is
      // inside a hidden tab pane, a closed drawer, a collapsed section — not
      // that it is genuinely zero wide. Keeping the last real measurement is
      // what lets a chart survive being hidden and shown again; without it the
      // `width > 0` guard in every caller blanks the drawing on the way out
      // and leaves it blank until the next resize.
      if (w <= 0) return;
      // Round to whole pixels: sub-pixel churn would redraw on every frame
      // during a resize for no visible gain.
      setWidth(Math.round(w));
    });

    observer.observe(node);
    const initial = Math.round(node.getBoundingClientRect().width);
    if (initial > 0) setWidth(initial);

    return () => observer.disconnect();
  }, [ref]);

  return width;
}
