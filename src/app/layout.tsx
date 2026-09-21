import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../index.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Tideline — Australian fishing conditions',
  description:
    'Wind, swell, tide and rain for Australian coastal fishing spots, with a score for how the fishing looks.',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The map rail runs to the edges of a phone, so the safe-area insets that
  // index.css reads have to be populated.
  viewportFit: 'cover',
  themeColor: '#2a78d6',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
