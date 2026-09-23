/**
 * The history block.
 *
 * What is worth pinning down is when it appears at all — it has three empty
 * states and only one of them should render nothing — and that an hour with
 * no readings stays distinguishable from an hour that scored zero.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { NearbySpot, SpotStats as Stats } from '../api/stats';
import { SpotStats } from './SpotStats';

const EMPTY: Stats = {
  samples: 0,
  days: 30,
  byHour: [],
  distribution: [],
  factors: null,
  unfishableShare: 0,
};

function withHistory(over: Partial<Stats> = {}): Stats {
  return {
    ...EMPTY,
    samples: 300,
    byHour: [
      { hour: 5, avgScore: 40, bestScore: 60, samples: 100 },
      { hour: 6, avgScore: 88, bestScore: 97, samples: 100 },
      { hour: 17, avgScore: 52, bestScore: 71, samples: 100 },
    ],
    factors: { tide: 0.6, wind: 0.5, wave: 0.7, weather: 0.9, windDir: 0.7 },
    ...over,
  };
}

const NEARBY: NearbySpot[] = [
  { id: 'a'.repeat(24), name: 'The wall', lat: -33.98, lon: 151.22, distanceM: 840, nextAt: null, nextScore: 41 },
  { id: 'b'.repeat(24), name: 'Manly', lat: -33.79, lon: 151.28, distanceM: 10_480, nextAt: null, nextScore: null },
];

function setup(props: Partial<React.ComponentProps<typeof SpotStats>> = {}) {
  const onSelect = vi.fn();
  render(<SpotStats stats={null} nearby={[]} km={25} onSelect={onSelect} {...props} />);
  return { onSelect };
}

describe('SpotStats', () => {
  it('renders nothing at all when there is no history and nothing nearby', () => {
    const { container } = render(
      <SpotStats stats={null} nearby={[]} km={25} onSelect={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('still appears for a saved spot with nothing kept yet, and says so', () => {
    setup({ stats: EMPTY });
    expect(screen.getByText(/nothing kept for this spot yet/i)).toBeInTheDocument();
  });

  it('names the hour that usually fishes best', () => {
    setup({ stats: withHistory() });
    // Scoped to the callout: '6am' is also one of the four axis anchors.
    expect(screen.getByText('6am', { selector: 'b' })).toBeInTheDocument();
  });

  it('says how much it is drawing on', () => {
    setup({ stats: withHistory() });
    expect(screen.getByText(/300 hours kept over the last 30 days/)).toBeInTheDocument();
  });

  it('mentions the unfishable share only when there is one', () => {
    setup({ stats: withHistory({ unfishableShare: 0.12 }) });
    expect(screen.getByText(/12% of them unfishable/)).toBeInTheDocument();
  });

  it('leaves the unfishable clause out when nothing was gated', () => {
    setup({ stats: withHistory({ unfishableShare: 0 }) });
    expect(screen.queryByText(/unfishable/)).not.toBeInTheDocument();
  });

  it('draws a bar for every hour of the day, kept or not', () => {
    const { container } = render(
      <SpotStats stats={withHistory()} nearby={[]} km={25} onSelect={() => {}} />,
    );
    expect(container.querySelectorAll('.hour')).toHaveLength(24);
  });

  it('marks the hours with nothing kept, so a gap cannot read as a calm hour', () => {
    const { container } = render(
      <SpotStats stats={withHistory()} nearby={[]} km={25} onSelect={() => {}} />,
    );
    // Three hours have readings; the other twenty-one are gaps.
    expect(container.querySelectorAll('.hour[data-empty]')).toHaveLength(21);
  });

  it('lists what is nearby with a readable distance', () => {
    setup({ nearby: NEARBY });

    expect(screen.getByText('840 m')).toBeInTheDocument();
    expect(screen.getByText('10.5 km')).toBeInTheDocument();
  });

  it('shows the next score where there is one, and nothing where there is not', () => {
    setup({ nearby: NEARBY });

    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manly/ }).textContent).toBe('Manly10.5 km');
  });

  it('hands a chosen neighbour back as a point to move to', async () => {
    const { onSelect } = setup({ nearby: NEARBY });

    await userEvent.click(screen.getByRole('button', { name: /The wall/ }));

    expect(onSelect).toHaveBeenCalledWith({ lat: -33.98, lon: 151.22 });
  });

  it('names the radius it searched', () => {
    setup({ nearby: NEARBY, km: 40 });
    expect(screen.getByText(/within 40 km/i)).toBeInTheDocument();
  });
});
