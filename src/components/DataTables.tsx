import { Grid, Tabs } from 'antd';
import type { FishingWindow } from '../domain/score';
import type { TideExtreme } from '../domain/tides';
import { TideTable } from './TideTable';
import { WhenToGo } from './WhenToGo';

interface DataTablesProps {
  windows: FishingWindow[];
  extremes: TideExtreme[];
  utcOffsetSeconds: number;
  now: number;
}

/**
 * The two tables, and the decision about how they share the page.
 *
 * This module exists to be a code-splitting boundary as much as a component.
 * antd's `Table` and `Tabs` together are the heaviest thing the app imports —
 * far heavier than the handful of rows they render — and nothing here is on
 * screen until a spot has been picked and its forecast has arrived. Loading
 * them behind that wait costs the reader nothing and keeps the first paint,
 * which is the map, clear of them.
 *
 * Side by side needs real width, so below `lg` the two collapse into tabs.
 * That is a genuine viewport question rather than a container one — it is
 * about how much screen the reader has, not how wide this column happens to
 * be — which is the case `useBreakpoint` is actually for.
 */
export default function DataTables({
  windows,
  extremes,
  utcOffsetSeconds,
  now,
}: DataTablesProps) {
  const screens = Grid.useBreakpoint();
  const split = screens.lg ?? false;

  const items = [
    {
      key: 'go',
      label: 'When to go',
      children: <WhenToGo windows={windows} utcOffsetSeconds={utcOffsetSeconds} now={now} />,
    },
    {
      key: 'tides',
      label: 'Next tides',
      children: <TideTable extremes={extremes} utcOffsetSeconds={utcOffsetSeconds} now={now} />,
    },
  ];

  return (
    <div className="tables" data-split={String(split)}>
      {split ? (
        items.map((item) => (
          <section key={item.key}>
            <h2 className="sec">{item.label}</h2>
            {item.children}
          </section>
        ))
      ) : (
        <Tabs items={items} />
      )}
    </div>
  );
}
