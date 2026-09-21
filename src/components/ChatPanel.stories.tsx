import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ChatPanel } from './ChatPanel';

/**
 * Asking about the spot.
 *
 * The panel is the only place in the app where text arrives rather than being
 * drawn, and the replies are the longest prose on the page — so these stories
 * are worth flipping the palette on. A paragraph has to hold its line length
 * and its contrast against both grounds without borrowing a card or a bubble
 * to sit in.
 */
const meta = {
  title: 'Instrument/ChatPanel',
  component: ChatPanel,
  args: {
    messages: [],
    pending: false,
    error: null,
    atLimit: false,
    onSend: fn(),
    onStop: fn(),
  },
} satisfies Meta<typeof ChatPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing asked yet: the openers are the whole interface. */
export const Empty: Story = {};

export const Answered: Story = {
  args: {
    messages: [
      { role: 'user', content: 'Is it worth going right now?' },
      {
        role: 'assistant',
        content:
          'Not yet — wait for about 3pm. Right now the tide is barely moving at 0.07 m/hr and the score is 54, but the run picks up through the afternoon and 3pm scores 91 with the wind down to 7 knots.\n\nThe swell is measured at the nearest cell the wave model covers, so treat 0.8 m as the open water rather than this exact spot. Check BOM before you go.',
      },
    ],
  },
};

/** Mid-answer: the reply is still arriving and the only control is Stop. */
export const Streaming: Story = {
  args: {
    pending: true,
    messages: [
      { role: 'user', content: 'When is the best window in the next two days?' },
      { role: 'assistant', content: 'The pick is tomorrow morning, 6am to 9am, averaging' },
    ],
  },
};

/** The gap before the first token, where the panel has to look alive. */
export const Thinking: Story = {
  args: {
    pending: true,
    messages: [
      { role: 'user', content: 'Why is the score what it is?' },
      { role: 'assistant', content: '' },
    ],
  },
};

/** The refusal a user can actually act on: asking faster than the key allows. */
export const Refused: Story = {
  args: {
    messages: [{ role: 'user', content: 'Is it worth going right now?' }],
    error: new Error('Too many questions at once. Give it a moment.'),
  },
};

/** Long enough that the server would refuse the next turn, so the field closes. */
export const AtLimit: Story = {
  args: {
    atLimit: true,
    messages: [
      { role: 'user', content: 'Why is the score what it is?' },
      { role: 'assistant', content: 'The tide is the weight — it is running at 0.27 m/hr.' },
    ],
  },
};
