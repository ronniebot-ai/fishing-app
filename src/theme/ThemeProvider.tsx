import { ConfigProvider } from 'antd';
import type { ReactNode } from 'react';
import { buildTheme } from './antdTheme';
import { useMode } from './useMode';

/**
 * Wires the palette into antd and into the document at the same moment.
 *
 * Note there is no `antd/dist/reset.css` import. antd's components carry their
 * own reset, scoped to `[class^="ant-"]`, and the global sheet would otherwise
 * fight index.css over heading weight and margins for no gain. The two text
 * inputs the saved-spot list needs are plain elements styled in App.css, not
 * antd's, so normalising every control the sheet covers still buys nothing.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useMode();

  return <ConfigProvider theme={buildTheme(mode)}>{children}</ConfigProvider>;
}
