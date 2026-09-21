/**
 * The ask panel. What matters is that a question is one gesture, that a reply
 * still being written is visibly still being written, and that the limits the
 * server enforces are visible here rather than arriving as a refusal.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';

function setup(props: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const onSend = vi.fn();
  const onStop = vi.fn();
  render(
    <ChatPanel
      messages={[]}
      pending={false}
      error={null}
      atLimit={false}
      onSend={onSend}
      onStop={onStop}
      {...props}
    />,
  );
  return { onSend, onStop, user: userEvent.setup() };
}

const field = () => screen.getByLabelText('Ask a question about this spot');

describe('ChatPanel', () => {
  it('sends on Enter, so asking is one gesture', async () => {
    const { onSend, user } = setup();

    await user.type(field(), 'Is it worth going?{Enter}');

    expect(onSend).toHaveBeenCalledWith('Is it worth going?');
  });

  it('keeps Shift+Enter for a second line rather than sending', async () => {
    const { onSend, user } = setup();

    await user.type(field(), 'One{Shift>}{Enter}{/Shift}two');

    expect(onSend).not.toHaveBeenCalled();
    expect(field()).toHaveValue('One\ntwo');
  });

  it('clears the field once the question is away', async () => {
    const { user } = setup();

    await user.type(field(), 'Why?{Enter}');

    expect(field()).toHaveValue('');
  });

  it('will not send an empty question', async () => {
    const { onSend, user } = setup();

    await user.type(field(), '   ');

    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('asks the opener that was pressed, so an empty panel is not a blank field', async () => {
    const { onSend, user } = setup();

    await user.click(screen.getByRole('button', { name: 'Why is the score what it is?' }));

    expect(onSend).toHaveBeenCalledWith('Why is the score what it is?');
  });

  it('shows the conversation with both sides attributed', () => {
    setup({
      messages: [
        { role: 'user', content: 'Is it worth going?' },
        { role: 'assistant', content: 'Yes — 3pm is the pick.' },
      ],
    });

    expect(screen.getByText('Is it worth going?')).toBeInTheDocument();
    expect(screen.getByText('Yes — 3pm is the pick.')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();
    // The openers are for an empty panel; there is a conversation now.
    expect(screen.queryByRole('button', { name: /worth going right now/ })).not.toBeInTheDocument();
  });

  it('shows a half-written reply as it arrives', () => {
    setup({
      pending: true,
      messages: [
        { role: 'user', content: 'Why?' },
        { role: 'assistant', content: 'Because the tide' },
      ],
    });

    expect(screen.getByText('Because the tide')).toBeInTheDocument();
  });

  it('says it is thinking before the first word lands', () => {
    setup({
      pending: true,
      messages: [
        { role: 'user', content: 'Why?' },
        { role: 'assistant', content: '' },
      ],
    });

    expect(screen.getByText('Thinking…')).toBeInTheDocument();
  });

  it('offers a stop while an answer is being written, and nothing to press twice', async () => {
    const { onStop, user } = setup({ pending: true, messages: [{ role: 'user', content: 'Why?' }] });

    expect(screen.queryByRole('button', { name: 'Ask' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(onStop).toHaveBeenCalled();
  });

  it('announces a failure rather than leaving the question unanswered in silence', () => {
    setup({ error: new Error('Too many questions at once. Give it a moment.') });

    expect(screen.getByRole('alert')).toHaveTextContent('Too many questions at once.');
  });

  it('closes the field at the turn limit, and says how to start over', () => {
    setup({ atLimit: true });

    expect(field()).toBeDisabled();
    expect(field()).toHaveAttribute('placeholder', expect.stringMatching(/start over/i));
  });

  it('carries the standing caveat, which no answer removes', () => {
    setup();

    expect(screen.getByText(/Check BOM before you go/)).toBeInTheDocument();
  });
});
