import type { StorybookConfig } from '@storybook/react-vite';

/**
 * The React/Vite framework rather than the Next one, deliberately.
 *
 * Every story renders a leaf component, and none of them touch `next/*` — the
 * one `next/dynamic` call in the app wraps SpotMap from App.tsx, above the
 * layer stories exercise. The Next preset would buy nothing for that and costs
 * something real: it aliases modules through `sb-original`, which the portable
 * stories in `stories.smoke.test.tsx` cannot resolve, because they run under
 * plain Vitest with no Storybook builder in front of them.
 *
 * Storybook builds with its own Vite config here. It used to inherit the app's
 * and have the PWA plugin filtered back out; Next builds with Turbopack and
 * ships no vite.config.ts, so there is nothing left to inherit or to strip.
 */
const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../src/**/*.stories.tsx'],
};

export default config;
