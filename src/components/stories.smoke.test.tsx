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
import * as spine from './Spine.stories';
import * as tideTable from './TideTable.stories';
import * as verdict from './Verdict.stories';
import * as whenToGo from './WhenToGo.stories';

setProjectAnnotations([preview]);

const modules = { verdict, readout, whenToGo, spine, tideTable };

/**
 * Nothing here is allowed to render blank any more.
 *
 * Both former members earned their way out. `TideTable` is an antd `Table`
 * now, which keeps its header and puts a sentence where the rows would be; and
 * `Spine` drops only the tide panel inland rather than the whole drawing,
 * because wind and rain still reach the spot.
 */
const DRAWS_NOTHING = new Set<string>();

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
