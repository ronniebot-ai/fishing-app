import type { Decorator, Preview } from '@storybook/react-vite';
// The app's styling is entirely global CSS keyed off custom properties on
// :root, so a story renders unstyled unless both sheets are loaded here.
// SpotMap brings Leaflet's own stylesheet with it.
import '../src/index.css';
import '../src/app/App.css';

/**
 * Mirror the app's theme switch.
 *
 * The palette hangs off `data-theme` on the document element, so the toolbar
 * writes there rather than wrapping the story — a wrapper would leave the
 * canvas background on the old palette and make every contrast judgement
 * wrong. Writing it during render is safe because it is idempotent and the
 * target sits outside React's tree; the value is defaulted rather than
 * assumed, since portable stories composed in the test run do not always
 * carry the toolbar's globals.
 */
const withTheme: Decorator = (Story, context) => {
  document.documentElement.dataset.theme = String(context.globals.theme ?? 'dark');
  return <Story />;
};

/**
 * Put the story where it lives in the app.
 *
 * Every component below the map is a child of `.instrument`, which supplies
 * the padding and the scroll container the type is measured against. Stories
 * are capped near the real column width so line lengths match what ships.
 */
const withInstrument: Decorator = (Story, context) => {
  if (context.parameters.bare) return <Story />;

  return (
    <div className="instrument" style={{ maxWidth: 640 }}>
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withInstrument, withTheme],
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true },
  },
  globalTypes: {
    theme: {
      description: 'App palette',
      toolbar: {
        title: 'Theme',
        icon: 'contrast',
        items: [
          { value: 'dark', title: 'Dark' },
          { value: 'light', title: 'Light' },
        ],
        dynamicTitle: true,
      },
    },
  },
  // Dark is the app's primary palette, so it is the one stories open in.
  initialGlobals: { theme: 'dark' },
};

export default preview;
