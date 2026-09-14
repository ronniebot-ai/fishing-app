import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// Two targets share one renderer:
//   `vite build`                  -> dist/      web + installable PWA
//   `vite build --mode electron`  -> dist-app/  desktop shell
//
// Vitest resolves this same file under mode `test`, which is why the service
// worker is skipped there too - generating one per test run is pure cost.
//
// The desktop build drops the service worker (the app:// scheme serves the
// files directly, so a caching layer on top only adds staleness) and uses
// relative asset URLs so they resolve under a custom scheme.
export default defineConfig(({ mode }) => {
  const isElectron = mode === 'electron'
  const isTest = mode === 'test'

  return {
    base: isElectron ? './' : '/',
    build: {
      outDir: isElectron ? 'dist-app' : 'dist',
      emptyOutDir: true,
    },
    plugins: [
      react(),
      apiServer(),
      ...(isElectron || isTest
        ? []
        : [
            VitePWA({
              registerType: 'autoUpdate',
              includeAssets: ['favicon.svg'],
              manifest: {
                name: 'Tideline — Australian fishing conditions',
                short_name: 'Tideline',
                description:
                  'Wind, swell, tide and rain for Australian coastal fishing spots, with a conditions score.',
                theme_color: '#07202e',
                background_color: '#07202e',
                display: 'standalone',
                orientation: 'portrait',
                start_url: '/',
                icons: [
                  { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
                  { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
                  {
                    src: 'pwa-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                  },
                ],
              },
              workbox: {
                runtimeCaching: [
                  {
                    // Map tiles: serve from cache first, they never change.
                    urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/,
                    handler: 'CacheFirst',
                    options: {
                      cacheName: 'osm-tiles',
                      expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
                      cacheableResponse: { statuses: [0, 200] },
                    },
                  },
                  {
                    // Forecasts: prefer the network, but fall back to the last
                    // good response so a spot already viewed still opens.
                    urlPattern: /^https:\/\/(marine-)?api\.open-meteo\.com\/.*/,
                    handler: 'NetworkFirst',
                    options: {
                      cacheName: 'open-meteo',
                      networkTimeoutSeconds: 6,
                      expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 6 },
                      cacheableResponse: { statuses: [0, 200] },
                    },
                  },
                ],
              },
            }),
          ]),
    ],

    // Three suites with different needs, kept apart so none pays for the
    // others: the domain maths is pure and runs in node, anything rendering
    // React needs a DOM, and the server is CommonJS with a real database
    // behind it. The split is by location and extension - `.test.ts` under
    // src is domain, `.test.tsx` is a component, anything under server/ is
    // the backend - so a new file lands in the right project by being named
    // and placed for what it is.
    test: {
      projects: [
        {
          test: {
            name: 'domain',
            environment: 'node',
            include: ['src/**/*.test.ts'],
          },
        },
        {
          test: {
            name: 'components',
            environment: 'jsdom',
            include: ['src/**/*.test.tsx'],
            setupFiles: ['./src/test/setup.ts'],
          },
        },
        {
          test: {
            name: 'server',
            environment: 'node',
            include: ['server/**/*.test.js'],
          },
        },
      ],
    },
  }
})

/**
 * Serves the saved-spots API alongside the app during `vite dev` and
 * `vite preview`.
 *
 * An Express app is a plain connect middleware, so the backend drops straight
 * into Vite's stack. That keeps `npm run dev` a single command and puts the
 * API on the same origin as the page, which is what lets the client use
 * relative URLs in every build except the desktop one.
 *
 * The require is deferred: `vitest` and `storybook` load this config too, and
 * neither should open a database to do it.
 */
function apiServer(): Plugin {
  const require = createRequire(import.meta.url)
  let api: ReturnType<typeof buildApi> | null = null

  function buildApi() {
    const { openDb } = require('./server/db.cjs')
    const { createApi } = require('./server/api.cjs')
    const file =
      process.env.TIDELINE_DB ??
      fileURLToPath(new URL('./server/data/spots.db', import.meta.url))
    return createApi(openDb(file))
  }

  const middleware = () => (api ??= buildApi())

  return {
    name: 'tideline:api',
    configureServer(server) {
      server.middlewares.use(middleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware())
    },
  }
}
