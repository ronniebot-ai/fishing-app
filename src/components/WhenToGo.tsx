import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { FishingWindow } from '../domain/score';
import { epochToSpotTime, scoreBand } from '../domain/units';

interface WhenToGoProps {
  windows: FishingWindow[];
  utcOffsetSeconds: number;
  now: number;
}

interface Row {
  key: number;
  day: string;
  window: string;
  peak: string;
  score: number;
  tone: string;
  live: boolean;
}

/** Today / Tomorrow / weekday, in the spot's own timezone. */
function dayLabel(t: number, utcOffsetSeconds: number, now: number): string {
  const shift = (ms: number) => new Date(ms + utcOffsetSeconds * 1000);
  const at = shift(t);
  const today = shift(now);
  const days =
    (Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) -
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) /
    86_400_000;

  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    at.getUTCDay()
  ];
}

const columns: ColumnsType<Row> = [
  { title: 'Day', dataIndex: 'day', key: 'day' },
  { title: 'Window', dataIndex: 'window', key: 'window', className: 'cell-big' },
  { title: 'Best around', dataIndex: 'peak', key: 'peak', align: 'right', className: 'cell-big' },
  {
    title: 'Score',
    dataIndex: 'score',
    key: 'score',
    align: 'right',
    className: 'cell-score',
    render: (score: number, row) => <span className={`tone-${row.tone}`}>{score}</span>,
  },
];

/**
 * The windows worth driving to, strongest first.
 *
 * A table because that is what it is: a few rows compared on the same three
 * measures. Ranking is carried by the order and the score, so numbered markers
 * would only repeat what the sort already says.
 *
 * The heading lives in the page, not here: on a narrow screen these rows sit
 * behind a tab that supplies its own label.
 */
export function WhenToGo({ windows, utcOffsetSeconds, now }: WhenToGoProps) {
  const rows: Row[] = windows.map((w) => ({
    key: w.startT,
    day: now >= w.startT && now < w.endT ? 'Now' : dayLabel(w.startT, utcOffsetSeconds, now),
    window: `${epochToSpotTime(w.startT, utcOffsetSeconds)} – ${epochToSpotTime(w.endT, utcOffsetSeconds)}`,
    peak: epochToSpotTime(w.peakT, utcOffsetSeconds),
    score: w.score,
    tone: scoreBand(w.score).tone,
    live: now >= w.startT && now < w.endT,
  }));

  return (
    <div className="data-table">
      <Table<Row>
        columns={columns}
        dataSource={rows}
        pagination={false}
        size="small"
        rowClassName={(row) => (row.live ? 'is-now' : '')}
        // Not antd's `Empty`: its illustration is a grey geometric sketch that
        // belongs to no part of this app, and an empty state here is a
        // sentence, not a picture.
        locale={{
          emptyText: (
            <p className="empty">
              Nothing worth a trip in the next two days — wind or swell is against you
              the whole way through. The forecast refreshes hourly, so it is worth
              another look this evening.
            </p>
          ),
        }}
      />
    </div>
  );
}
