import { ConfigProvider } from 'antd';
import type { ReactNode } from 'react';
import { buildTheme } from './antdTheme';
import { useMode } from './useMode';

/**
 * Wires the palette into antd and into the document at the same moment.
 *
 * Note there is no `antd/dist/reset.css` import. antd's components carry their
 * own reset, scoped to `[class^="ant-"]`, and the global sheet would otherwise
 * fight index.css over heading weight and margins for no gain — this app has
 * no form controls, which is most of what that file exists to normalise.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useMode();

  return <ConfigProvider theme={buildTheme(mode)}>{children}</ConfigProvider>;
}
