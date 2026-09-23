/**
 * The one place Tideline's colours are defined.
 *
 * Two consumers need the same values and cannot share a mechanism:
 * hand-written CSS and raw SVG read `var(--curve)`, while antd reads JS design
 * tokens. antd v6 does emit CSS variables, but it scopes them to a class it
 * stamps on each component root rather than to `:root`, so nothing outside an
 * antd subtree can see them. Rather than maintain two palettes that drift,
 * this module owns the literals and both sides are fed from here — see
 * `buildTheme` and `applyCssVars` in ./antdTheme.
 *
 * The `:root` blocks in index.css hold the same values a second time on
 * purpose: they are what paints during the window before JS has run. The two
 * copies must agree. `applyCssVars` writes this file's values as inline style
 * on `<html>`, which outranks the stylesheet — so a colour changed only in
 * index.css looks right until hydration and is then silently reverted.
 *
 * Only the keys antd needs live here. The spine's own colours — the score
 * bands, their washes, the chart panel and the day divider — are CSS-only,
 * because nothing outside the chart reads them and antd has no token to feed
 * them to. They are therefore not in `cssVarName` and not overwritten.
 */

export type Mode = 'dark' | 'light';

export interface Palette {
  ground: string;
  raised: string;
  ink: string;
  dim: string;
  rule: string;
  ruleSoft: string;
  curve: string;
  curveInk: string;
  curveFill: string;
  wash: string;
  gust: string;
  accent: string;
  good: string;
  warn: string;
  bad: string;
  shadow: string;
}

/**
 * Dark is the primary palette, not the alternate: the app is opened before
 * dawn as often as at noon, and the ground is a nautical chart's deepest
 * depth band. Series colours are validated against their own ground.
 */
export const palette: Record<Mode, Palette> = {
  dark: {
    ground: '#07202e',
    raised: '#0b2a3a',
    ink: '#e8f1f2',
    dim: '#7fa0ad',
    rule: '#16394b',
    ruleSoft: '#102f40',
    curve: '#86e3f2',
    curveInk: '#a8eef9',
    curveFill: 'rgba(134, 227, 242, 0.13)',
    wash: 'rgba(134, 227, 242, 0.1)',
    gust: '#ffc880',
    accent: '#f2617a',
    good: '#5bd8a6',
    warn: '#f2a65a',
    bad: '#f2617a',
    shadow: 'rgba(0, 0, 0, 0.34)',
  },
  light: {
    ground: '#e9efee',
    raised: '#fbfcfb',
    ink: '#0a2029',
    dim: '#4e6e78',
    rule: '#c4d5d5',
    ruleSoft: '#d8e3e2',
    curve: '#0086a0',
    curveInk: '#056e85',
    curveFill: 'rgba(0, 134, 160, 0.14)',
    wash: 'rgba(0, 134, 160, 0.1)',
    gust: '#b85c00',
    accent: '#c9315a',
    good: '#0b7a55',
    warn: '#a86400',
    bad: '#c9315a',
    shadow: 'rgba(10, 32, 41, 0.14)',
  },
};

/** CSS custom property name for each palette key, so the two stay in step. */
export const cssVarName: Record<keyof Palette, string> = {
  ground: '--ground',
  raised: '--raised',
  ink: '--ink',
  dim: '--dim',
  rule: '--rule',
  ruleSoft: '--rule-soft',
  curve: '--curve',
  curveInk: '--curve-ink',
  curveFill: '--curve-fill',
  wash: '--wash',
  gust: '--gust',
  accent: '--accent',
  good: '--good',
  warn: '--warn',
  bad: '--bad',
  shadow: '--shadow',
};

export const SANS = "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif";
export const COND = "'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif";

/**
 * The type scale, in px. Roughly a 1.25 ratio; everything in the interface
 * sits on one of these steps. Condensed is used from `lg` up and for every
 * number, whatever its size.
 */
export const type = {
  xs: 11,
  sm: 12.5,
  base: 14,
  md: 16,
  lg: 20,
  xl: 25,
  xxl: 32,
  display: 44,
} as const;
