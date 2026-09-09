/**
 * Every story renders, through the real preview decorators.
 *
 * Storybook's build only type-checks and bundles the stories — it will
 * happily ship one that throws the moment it mounts. Composing them here runs
 * each against `.storybook/preview`, so a fixture that drifts out of shape
 * fails in `npm test` rather than in the browser.
 *
 * SpotMap is left out on purpose: Leaflet measures a real viewport and has no
 * meaningful behaviour in jsdom.
 */
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import preview from '../../.storybook/preview';
import * as readout from './Readout.stories';
import * as tideChart from './TideChart.stories';
import * as tideTable from './TideTable.stories';
import * as verdict from './Verdict.stories';
import * as whenToGo from './WhenToGo.stories';
import * as windRain from './WindRainChart.stories';

setProjectAnnotations([preview]);

const modules = { verdict, readout, whenToGo, tideChart, windRain, tideTable };

/**
 * Stories whose component correctly draws nothing: `TideChart` and
 * `TideTable` both bail out rather than frame an empty plot, and the app
 * supplies the surrounding copy. Listing them here means a *data-bearing*
 * story going silently blank is still a failure.
 */
const DRAWS_NOTHING = new Set(['tideChart/NoMarineData', 'tideTable/NoTides']);

describe.each(Object.entries(modules))('%s stories', (name, module) => {
  // `composeStories` is generic over the whole module, so the entries come
  // back too wide to use as JSX without saying what they are.
  const stories = Object.entries(composeStories(module)) as [string, ComponentType][];

  it('exports at least one story', () => {
    expect(stories.length).toBeGreaterThan(0);
  });

  it.each(stories)('%s renders', (storyName, Story) => {
    const { container } = render(<Story />);

    // Reach past the `.instrument` decorator to what the story itself drew.
    const drawn = container.querySelector('.instrument') ?? container;

    if (DRAWS_NOTHING.has(`${name}/${storyName}`)) {
      expect(drawn).toBeEmptyDOMElement();
    } else {
      expect(drawn).not.toBeEmptyDOMElement();
    }
  });
});
