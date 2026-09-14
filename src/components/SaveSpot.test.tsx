/**
 * The save control. The rule that matters is that naming stays optional: an
 * empty field is the ordinary case, so it must reach the server as "you name
 * it" rather than as an empty string or a blocked submit.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { savedSpots } from '../fixtures/spots';
import { SaveSpot } from './SaveSpot';

const SPOT = { lat: -33.8908, lon: 151.2743 };

function setup(props: Partial<Parameters<typeof SaveSpot>[0]> = {}) {
  const onSave = vi.fn();
  render(
    <SaveSpot spot={SPOT} saved={null} saving={false} error={null} onSave={onSave} {...props} />,
  );
  return { onSave, user: userEvent.setup() };
}

describe('SaveSpot', () => {
  it('saves with no name at all, leaving the numbering to the server', async () => {
    const { onSave, user } = setup();

    await user.click(screen.getByRole('button', { name: 'Save spot' }));

    expect(onSave).toHaveBeenCalledWith(undefined);
  });

  it('passes a name the user typed', async () => {
    const { onSave, user } = setup();

    await user.type(screen.getByLabelText('Name this spot'), 'The wall');
    await user.click(screen.getByRole('button', { name: 'Save spot' }));

    expect(onSave).toHaveBeenCalledWith('The wall');
  });

  it('treats whitespace as no name rather than saving it', async () => {
    const { onSave, user } = setup();

    await user.type(screen.getByLabelText('Name this spot'), '   ');
    await user.click(screen.getByRole('button', { name: 'Save spot' }));

    expect(onSave).toHaveBeenCalledWith(undefined);
  });

  it('saves on Enter, so the name and the press are one gesture', async () => {
    const { onSave, user } = setup();

    await user.type(screen.getByLabelText('Name this spot'), 'The wall{Enter}');

    expect(onSave).toHaveBeenCalledWith('The wall');
  });

  it('clears the field afterwards, so the next spot starts empty', async () => {
    const { user } = setup();
    const field = screen.getByLabelText('Name this spot');

    await user.type(field, 'The wall{Enter}');

    expect(field).toHaveValue('');
  });

  it('blocks a second press while the first is in flight', () => {
    setup({ saving: true });

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('offers no form once the spot is kept, and says what it is called', () => {
    setup({ saved: savedSpots[2] });

    expect(screen.getByText('The wall')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('announces a refusal rather than failing quietly', () => {
    setup({ error: new Error('Already saved as The wall.') });

    expect(screen.getByRole('alert')).toHaveTextContent('Already saved as The wall.');
  });
});
