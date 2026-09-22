'use client';

import { AntdRegistry } from '@ant-design/nextjs-registry';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ThemeProvider } from '../theme/ThemeProvider';

/**
 * Everything the tree needs that cannot exist on the server.
 *
 * `AntdRegistry` is outermost because it collects the style rules antd's
 * css-in-js emits during the server render and flushes them into the HTML.
 * Without it the first paint arrives unstyled and antd restyles it after
 * hydration.
 */
export function Providers({ children }: { children: ReactNode }) {
  // Held in state rather than at module scope: a module is shared across every
  // request the server handles, and two visitors must not share a query cache.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Model output only changes hourly; refetching on every focus would
            // burn the free tier for nothing.
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <AntdRegistry>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ThemeProvider>
    </AntdRegistry>
  );
}
