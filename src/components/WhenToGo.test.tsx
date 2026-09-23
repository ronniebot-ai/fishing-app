/**
 * The windows table. The ranking is carried by row order alone, so the tests
 * assert order as well as content — a correct set of rows in the wrong
 * sequence would be a real bug the component gives no other signal about.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NOW, SYDNEY_UTC_OFFSET, windows } from '../fixtures/conditions';
import { WhenToGo } from './WhenToGo';

function renderWindows(now = NOW) {
  return render(
    <WhenToGo windows={windows} utcOffsetSeconds={SYDNEY_UTC_OFFSET} now={now} />,
  );
}

/** Body rows only — `getAllByRole('row')` would include the header. */
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('WhenToGo', () => {
  it('lists the windows strongest first', () => {
    renderWindows();

    // The evening window leads: last light with the tide a third of the way
    // out is the only combination that clears the off-peak cap.
    expect(bodyRows().map((r) => within(r).getAllByRole('cell')[3].textContent)).toEqual([
      '83',
      '65',
      '59',
    ]);
  });

  it('renders each window in the spot\'s own timezone, not the browser\'s', () => {
    renderWindows();

    const cells = within(bodyRows()[0]).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('5:00pm – 8:00pm');
    expect(cells[2]).toHaveTextContent('6:00pm');
  });

  it('labels the window containing `now` as Now, and dates the rest', () => {
    // 6pm, inside the leading 5-8pm window.
    renderWindows(NOW + 3 * 3_600_000);

    const days = bodyRows().map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(days).toEqual(['Now', 'Today', 'Today']);
    expect(bodyRows()[0]).toHaveClass('is-now');
    expect(bodyRows()[1]).not.toHaveClass('is-now');
  });

  it('drops the Now label once the clock has moved past the window', () => {
    // Midday, which falls in the third window rather than the first.
    renderWindows(NOW - 3 * 3_600_000);

    const days = bodyRows().map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(days).toEqual(['Today', 'Today', 'Now']);
  });

  it('explains itself instead of listing nothing', () => {
    render(<WhenToGo windows={[]} utcOffsetSeconds={SYDNEY_UTC_OFFSET} now={NOW} />);

    // The table keeps its header — the columns are still the answer's shape —
    // but carries a sentence where the rows would be rather than a blank grid.
    expect(bodyRows().some((r) => within(r).queryByText(/^\d+$/))).toBe(false);
    expect(screen.getByText(/Nothing worth a trip/)).toBeInTheDocument();
  });
});
