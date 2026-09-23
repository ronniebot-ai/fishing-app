/**
 * The headline call. Two things matter here and neither is the number: that
 * the *word* matches the band, and that a tripped gate is announced rather
 * than just styled.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { gatedScore, primeScore, roughScore, score } from '../fixtures/conditions';
import { Verdict } from './Verdict';

const SUMMARY = 'Tide coming in, light southerly, small swell.';

describe('Verdict', () => {
  it('leads with the band word and follows with the score', () => {
    render(<Verdict score={primeScore} summary={SUMMARY} />);

    expect(screen.getByText('Prime')).toBeInTheDocument();
    expect(screen.getByText(String(primeScore.score))).toBeInTheDocument();
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
  });

  it('bands a middling score as Fair rather than Prime', () => {
    // The same calm conditions hours off the light. Only Prime is withheld.
    render(<Verdict score={score} summary={SUMMARY} />);

    expect(screen.getByText('Fair')).toBeInTheDocument();
    expect(screen.queryByText('Prime')).not.toBeInTheDocument();
  });

  it('bands a blown-out hour as Poor', () => {
    render(<Verdict score={roughScore} summary={SUMMARY} />);

    expect(screen.getByText('Poor')).toBeInTheDocument();
  });

  it('stays silent about gates when none tripped', () => {
    render(<Verdict score={primeScore} summary={SUMMARY} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces a tripped gate to assistive tech, with the reason', () => {
    render(<Verdict score={gatedScore} summary={SUMMARY} />);

    // role=alert rather than a styled paragraph: this is the one message in
    // the app that must reach someone who is not looking at the screen.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Wind over 30 kn');
    expect(alert).toHaveTextContent('not safe on exposed ground');
  });
});
