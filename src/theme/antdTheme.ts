import { theme as antdTheme } from 'antd';
import type { ThemeConfig } from 'antd';
import { COND, SANS, cssVarName, palette, type, type Mode } from './palette';

/**
 * Feed antd's token system from Tideline's palette.
 *
 * Two things about antd v6 shape this file, and both fail silently if ignored:
 *
 * 1. Seed tokens are consumed by the algorithm and then *deleted* from the
 *    override set, so `colorPrimary` comes back re-derived rather than the hex
 *    handed in. Anything that has to land exactly is set as an alias below, or
 *    as a component token, which are applied after derivation.
 * 2. A `var(--x)` string in a seed is run through colour maths and silently
 *    becomes near-black. Every value here is a literal for that reason;
 *    `applyCssVars` handles the other direction.
 */
export function buildTheme(mode: Mode): ThemeConfig {
  const p = palette[mode];

  return {
    algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    cssVar: { prefix: 'ant', key: 'tideline' },
    token: {
      // Seeds: these drive the algorithm's derivations.
      colorPrimary: p.curve,
      colorInfo: p.curve,
      colorSuccess: p.good,
      colorWarning: p.warn,
      colorError: p.bad,
      colorLink: p.curveInk,
      colorBgBase: p.ground,
      colorTextBase: p.ink,
      fontFamily: SANS,
      fontSize: 15,
      // Two of the rules that keep antd from sounding like antd: a chart has
      // no drop shadows, and its corners are square.
      borderRadius: 2,
      wireframe: false,

      // Aliases: these land verbatim, so anything the derivation would have
      // guessed wrong is pinned here.
      colorBgLayout: p.ground,
      colorBgContainer: p.raised,
      colorBgElevated: p.raised,
      colorBgSpotlight: p.raised,
      colorBorder: p.rule,
      colorBorderSecondary: p.ruleSoft,
      // Computed from colorBorderSecondary against the container ground when
      // left alone, which lands nowhere near the palette. Pin it.
      colorSplit: p.ruleSoft,
      colorText: p.ink,
      colorTextSecondary: p.dim,
      colorTextTertiary: p.dim,
      colorTextQuaternary: p.dim,
      colorTextHeading: p.ink,
      colorTextDescription: p.dim,
      colorTextLabel: p.dim,
      colorIcon: p.dim,
      fontSizeSM: type.sm,
      fontSizeLG: type.md,
      fontSizeHeading2: type.lg,
      lineHeight: 1.55,
      borderRadiusLG: 2,
      borderRadiusSM: 2,
      // No shadows anywhere. A nautical chart does not have them, and they are
      // what makes a panel read as a generic card.
      boxShadow: 'none',
      boxShadowSecondary: 'none',
      boxShadowTertiary: 'none',
    },
    components: {
      // Component tokens are merged after derivation, so unlike seeds they
      // survive exactly as written.
      Table: {
        headerBg: 'transparent',
        headerColor: p.dim,
        headerSplitColor: 'transparent',
        borderColor: p.ruleSoft,
        rowHoverBg: p.wash,
        cellFontSize: 14.5,
        cellPaddingBlock: 9,
        cellPaddingInline: 0,
        footerBg: 'transparent',
      },
      Tabs: {
        inkBarColor: p.curve,
        itemColor: p.dim,
        itemSelectedColor: p.ink,
        itemHoverColor: p.ink,
        titleFontSize: type.base,
        horizontalMargin: '0 0 10px 0',
      },
      Alert: {
        defaultPadding: '9px 12px',
        withDescriptionPadding: '10px 13px',
      },
      Segmented: {
        itemSelectedBg: p.curve,
        itemSelectedColor: mode === 'dark' ? p.ground : '#ffffff',
        itemColor: p.dim,
        trackBg: 'transparent',
      },
      Empty: {
        colorTextDescription: p.dim,
      },
      Skeleton: {
        gradientFromColor: p.ruleSoft,
        gradientToColor: p.rule,
      },
    },
  };
}

/**
 * Mirror the palette onto `:root` as custom properties.
 *
 * This is what lets the SVG charts, the Leaflet overrides and every
 * hand-written rule keep reading `var(--curve)` while antd reads its own
 * tokens. Inline properties on the root element beat the stylesheet's `:root`
 * blocks, which is intended — once JS has run, this module is authoritative.
 */
export function applyCssVars(mode: Mode): void {
  const p = palette[mode];
  const root = document.documentElement.style;

  for (const key of Object.keys(cssVarName) as (keyof typeof cssVarName)[]) {
    root.setProperty(cssVarName[key], p[key]);
  }
  root.setProperty('--sans', SANS);
  root.setProperty('--cond', COND);
  root.setProperty('color-scheme', mode);
}
