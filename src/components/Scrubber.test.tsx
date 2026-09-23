/**
 * Dragging is a pointer gesture, and jsdom has no layout to drag across, so
 * the pointer path is exercised with a stubbed track rectangle. The keyboard
 * path needs none of that and carries the same clamping, which is the part
 * worth being sure of: the window can never leave the data behind it.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYDNEY_UTC_OFFSET } from '../fixtures/conditions';
import { Scrubber } from './Scrubber';

const HOUR = 3600_000;
const START = Date.UTC(2026, 8, 7, 0, 0);
/** 192 hours held, the shape `forecast_days=7&past_days=1` comes back in. */
const END = START + 192 * HOUR;
const NOW = START + 24 * HOUR;

afterEach(() => vi.restoreAllMocks());

function renderScrubber(props: Partial<Parameters<typeof Scrubber>[0]> = {}) {
  const onScrub = vi.fn();
  render(
    <Scrubber
      dataStart={START}
      dataEnd={END}
      startT={NOW - 24 * HOUR}
      hours={72}
      now={NOW}
      utcOffsetSeconds={SYDNEY_UTC_OFFSET}
      onScrub={onScrub}
      {...props}
    />,
  );
  return { onScrub, thumb: screen.getByRole('slider') };
}

describe('Scrubber', () => {
  it('sizes the thumb by how much of the forecast is on screen', () => {
    const { thumb } = renderScrubber();

    // 72 of 192 hours.
    expect(thumb.style.width).toBe(`${(72 / 192) * 100}%`);
    expect(thumb.style.left).toBe('0%');
  });

  it('steps an hour at a time with the arrows', () => {
    const { onScrub, thumb } = renderScrubber({ startT: START + 10 * HOUR });

    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(onScrub).toHaveBeenCalledWith(START + 11 * HOUR);

    fireEvent.keyDown(thumb, { key: 'ArrowLeft' });
    expect(onScrub).toHaveBeenLastCalledWith(START + 9 * HOUR);
  });

  it('moves a quarter of the window per page', () => {
    const { onScrub, thumb } = renderScrubber({ startT: START + 10 * HOUR });

    fireEvent.keyDown(thumb, { key: 'PageDown' });

    expect(onScrub).toHaveBeenCalledWith(START + 28 * HOUR);
  });

  it('cannot be pushed off either end of the data', () => {
    const { onScrub, thumb } = renderScrubber({ startT: START });
    fireEvent.keyDown(thumb, { key: 'ArrowLeft' });
    expect(onScrub).toHaveBeenCalledWith(START);

    onScrub.mockClear();
    fireEvent.keyDown(thumb, { key: 'End' });
    // The last position that still fills the window, not the last instant.
    expect(onScrub).toHaveBeenCalledWith(END - 72 * HOUR);
  });

  it('ignores keys that are not its own, so the page keeps them', () => {
    const { onScrub, thumb } = renderScrubber();

    fireEvent.keyDown(thumb, { key: 'Tab' });
    fireEvent.keyDown(thumb, { key: 'a' });

    expect(onScrub).not.toHaveBeenCalled();
  });

  it('draws nothing when the window already holds its whole reach', () => {
    // What the one-day range looks like: a bar that cannot move is furniture.
    render(
      <Scrubber
        dataStart={START}
        dataEnd={START + 24 * HOUR}
        startT={START}
        hours={24}
        now={NOW}
        utcOffsetSeconds={SYDNEY_UTC_OFFSET}
        onScrub={() => {}}
      />,
    );

    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('centres the window where the bare track is clicked', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 192, height: 20, x: 0, y: 0, top: 0, left: 0, right: 192, bottom: 20,
      toJSON: () => ({}),
    } as DOMRect);
    const { onScrub } = renderScrubber();

    // One pixel per hour, so 96px in is the 96th hour.
    fireEvent.pointerDown(screen.getByRole('slider').parentElement!, { clientX: 96 });

    expect(onScrub).toHaveBeenCalledWith(START + (96 - 36) * HOUR);
  });

  it('marks where the present falls in the whole forecast', () => {
    const { thumb } = renderScrubber();
    const mark = thumb.parentElement!.querySelector('.scrub-now') as HTMLElement;

    expect(mark.style.left).toBe(`${(24 / 192) * 100}%`);
  });
});
