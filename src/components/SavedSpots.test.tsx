/**
 * The library. Getting back to a spot is the reason it exists, so that is the
 * first thing checked; the rest is making sure neither destructive action —
 * removing, or blanking a name — can happen by accident.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { savedSpots } from '../fixtures/spots';
import { SavedSpots } from './SavedSpots';

function setup(props: Partial<Parameters<typeof SavedSpots>[0]> = {}) {
  const handlers = { onSelect: vi.fn(), onRename: vi.fn(), onRemove: vi.fn() };
  render(<SavedSpots spots={savedSpots} selected={null} {...handlers} {...props} />);
  return { ...handlers, user: userEvent.setup() };
}

describe('SavedSpots', () => {
  it('renders nothing at all when nothing has been saved', () => {
    const { container } = render(
      <SavedSpots
        spots={[]}
        selected={null}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('lists every spot with its coordinates', () => {
    setup();

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('The wall')).toBeInTheDocument();
    expect(screen.getByText('Spot 2')).toBeInTheDocument();
  });

  it('hands back the whole spot when one is chosen', async () => {
    const { onSelect, user } = setup();

    await user.click(screen.getByRole('button', { name: /The wall/ }));

    expect(onSelect).toHaveBeenCalledWith(savedSpots[2]);
  });

  it('marks the spot being read as current, for assistive tech too', () => {
    setup({ selected: { lat: savedSpots[2].lat, lon: savedSpots[2].lon } });

    expect(screen.getByRole('button', { name: /The wall/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  describe('renaming', () => {
    it('opens with the existing name, so it can be edited not retyped', async () => {
      const { user } = setup();

      await user.click(screen.getAllByRole('button', { name: 'Rename' })[2]);

      expect(screen.getByLabelText('Rename The wall')).toHaveValue('The wall');
    });

    it('commits on Enter', async () => {
      const { onRename, user } = setup();

      await user.click(screen.getAllByRole('button', { name: 'Rename' })[2]);
      await user.clear(screen.getByLabelText('Rename The wall'));
      await user.type(screen.getByLabelText('Rename The wall'), 'North wall{Enter}');

      expect(onRename).toHaveBeenCalledWith(3, 'North wall');
    });

    it('leaves the name alone when the field is emptied', async () => {
      const { onRename, user } = setup();

      await user.click(screen.getAllByRole('button', { name: 'Rename' })[2]);
      await user.clear(screen.getByLabelText('Rename The wall'));
      await user.keyboard('{Enter}');

      // Clearing is not how you get the default name back, so this is a no-op
      // rather than a request the server would refuse anyway.
      expect(onRename).not.toHaveBeenCalled();
      expect(screen.getByText('The wall')).toBeInTheDocument();
    });

    it('abandons the edit on Escape', async () => {
      const { onRename, user } = setup();

      await user.click(screen.getAllByRole('button', { name: 'Rename' })[2]);
      await user.type(screen.getByLabelText('Rename The wall'), ' north');
      await user.keyboard('{Escape}');

      expect(onRename).not.toHaveBeenCalled();
      expect(screen.getByText('The wall')).toBeInTheDocument();
    });
  });

  describe('removing', () => {
    it('takes two presses, and says so between them', async () => {
      const { onRemove, user } = setup();

      await user.click(screen.getAllByRole('button', { name: 'Remove' })[2]);
      expect(onRemove).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Sure?' }));
      expect(onRemove).toHaveBeenCalledWith(3);
    });

    it('forgets it was asked once focus moves away', async () => {
      const { onRemove, user } = setup();

      await user.click(screen.getAllByRole('button', { name: 'Remove' })[2]);
      await user.click(screen.getByRole('button', { name: /Spot 2/ }));

      expect(screen.queryByRole('button', { name: 'Sure?' })).not.toBeInTheDocument();
      expect(onRemove).not.toHaveBeenCalled();
    });
  });
});
