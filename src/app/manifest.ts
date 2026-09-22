import type { MetadataRoute } from 'next';

/**
 * The install manifest, carried over from the vite-plugin-pwa config.
 *
 * Next serves this at /manifest.webmanifest and links it from every page, so
 * unlike the Vite setup there is no separate registration to keep in step.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
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
      { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
