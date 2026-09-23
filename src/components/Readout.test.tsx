/**
 * The four readings. The rows are a presentational block with no roles of
 * their own, so these tests reach for the labels and read the row around
 * them — the same way someone scanning the panel does.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  extremes,
  inlandPoint,
  inlandScore,
  nowPoint,
  score,
  SYDNEY_UTC_OFFSET,
} from '../fixtures/conditions';
import { Readout } from './Readout';

/** The `.row` wrapping a given label. */
function row(label: string): HTMLElement {
  const cell = screen.getByText(label);
  const found = cell.closest('.row');
  if (!found) throw new Error(`no .row around "${label}"`);
  return found as HTMLElement;
}

function renderCoastal() {
  return render(
    <Readout
      point={nowPoint}
      score={score}
      extremes={extremes}
      utcOffsetSeconds={SYDNEY_UTC_OFFSET}
    />,
  );
}

describe('Readout', () => {
  it('shows all four readings with their units', () => {
    renderCoastal();

    expect(row('Wind')).toHaveTextContent('7kn');
    // The swell, not the combined sea: it is the height the score reads.
    expect(row('Swell')).toHaveTextContent('0.6m');
    expect(row('Tide')).toHaveTextContent('+0.83m');
    expect(row('Weather')).toHaveTextContent('22% cloud');
    // A dry hour says so in the note rather than printing "0.0mm".
    expect(row('Weather')).toHaveTextContent('no rain forecast');
    expect(row('Weather')).not.toHaveTextContent('mm');
  });

  it('spells out direction and gust rather than repeating the number', () => {
    renderCoastal();

    expect(row('Wind')).toHaveTextContent('south-easterly, gusting 13');
    expect(row('Swell')).toHaveTextContent('south-easterly, 11 second period');
  });

  it('says which way the tide is running and when it turns', () => {
    renderCoastal();

    expect(row('Tide')).toHaveTextContent('rising 0.18 m an hour, high at 4:30pm');
  });

  it('carries each factor\'s contribution as the hairline width', () => {
    renderCoastal();

    // Wind scored a clean 1, so its hairline runs the full width. This is the
    // only thing making the headline score accountable on screen.
    expect(row('Wind').style.getPropertyValue('--contrib')).toBe('100%');
    // Weather is cloud capped by rain; this hour is bright and dry, which is
    // the middle of that scale rather than the top of it.
    expect(row('Weather').style.getPropertyValue('--contrib')).toBe('59.4%');
  });

  it('marks marine rows "inland" when no ocean cell was reachable', () => {
    render(
      <Readout
        point={inlandPoint}
        score={inlandScore}
        extremes={[]}
        utcOffsetSeconds={SYDNEY_UTC_OFFSET}
      />,
    );

    // "inland" is the reason, not a generic "No data" — the distinction is
    // the whole point of the snap-to-ocean step upstream.
    expect(row('Swell')).toHaveTextContent('inland');
    expect(row('Tide')).toHaveTextContent('inland');
    expect(row('Swell')).toHaveClass('is-missing');
    expect(row('Tide')).toHaveClass('is-missing');

    // Wind and rain come from the clicked point and survive.
    expect(row('Wind')).not.toHaveClass('is-missing');
    expect(row('Wind')).toHaveTextContent('7kn');
  });
});
