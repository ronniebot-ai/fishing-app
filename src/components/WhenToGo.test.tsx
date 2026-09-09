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

    expect(bodyRows().map((r) => within(r).getAllByRole('cell')[3].textContent)).toEqual([
      '88',
      '78',
      '67',
    ]);
  });

  it('renders each window in the spot\'s own timezone, not the browser\'s', () => {
    renderWindows();

    const cells = within(bodyRows()[0]).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('11:00am – 4:00pm');
    expect(cells[2]).toHaveTextContent('2:00pm');
  });

  it('labels the window containing `now` as Now, and dates the rest', () => {
    renderWindows();

    const days = bodyRows().map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(days).toEqual(['Now', 'Today', 'Today']);
    expect(bodyRows()[0]).toHaveClass('is-now');
    expect(bodyRows()[1]).not.toHaveClass('is-now');
  });

  it('drops the Now label once the clock has moved past the window', () => {
    // 9pm — inside the second window, which should take the label over.
    renderWindows(NOW + 6 * 3_600_000);

    const days = bodyRows().map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(days).toEqual(['Today', 'Now', 'Today']);
  });

  it('explains itself instead of showing an empty table', () => {
    render(<WhenToGo windows={[]} utcOffsetSeconds={SYDNEY_UTC_OFFSET} now={NOW} />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing worth a trip/)).toBeInTheDocument();
  });
});
