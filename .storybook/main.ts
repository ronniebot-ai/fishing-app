import type { StorybookConfig } from '@storybook/react-vite';
import type { PluginOption } from 'vite';

/**
 * Drop the PWA plugin from a config Storybook is about to build with.
 *
 * `vite.config.ts` adds it for the web target, and Storybook reuses that file
 * wholesale. Left in, it tries to precache Storybook's own manager bundle and
 * fails the build on the 2 MiB workbox limit — and a service worker in the
 * preview iframe would serve stale stories besides.
 *
 * Filtering here rather than behind an env var in the npm script keeps this
 * true however Storybook is started, including a bare `npx storybook build`.
 */
function withoutPwa(plugins: PluginOption[]): PluginOption[] {
  return plugins.flatMap((plugin) => {
    if (Array.isArray(plugin)) return [withoutPwa(plugin)];
    if (plugin && 'name' in plugin && plugin.name.startsWith('vite-plugin-pwa')) return [];
    return [plugin];
  });
}

/**
 * Storybook otherwise reuses `vite.config.ts` as-is, so the renderer here is
 * built exactly the way the app is.
 */
const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../src/**/*.stories.tsx'],
  viteFinal: (config) => ({
    ...config,
    plugins: withoutPwa(config.plugins ?? []),
  }),
};

export default config;
