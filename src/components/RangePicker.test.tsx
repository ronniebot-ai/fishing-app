import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RANGES } from '../domain/range';
import { RangePicker } from './RangePicker';

const buttons = () => screen.getAllByRole('button');

describe('RangePicker', () => {
  it('offers every range', () => {
    render(<RangePicker range="three" onChange={() => {}} />);

    expect(buttons().map((b) => b.textContent)).toEqual(RANGES.map((r) => r.label));
  });

  it('marks the current one for a screen reader and for the stylesheet', () => {
    render(<RangePicker range="week" onChange={() => {}} />);

    const current = screen.getByRole('button', { pressed: true });
    expect(current).toHaveTextContent('1 week');
    expect(current).toHaveAttribute('data-current', 'true');
    // Exactly one: `aria-pressed` on a group only reads as a choice if the
    // rest are audibly not pressed.
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(RANGES.length - 1);
  });

  it('reports the key that was picked', () => {
    const onChange = vi.fn();
    render(<RangePicker range="three" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '1 day' }));

    expect(onChange).toHaveBeenCalledWith('day');
  });
});
