import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { TideExtreme } from '../domain/tides';
import { epochToSpotTime } from '../domain/units';

interface TideTableProps {
  extremes: TideExtreme[];
  utcOffsetSeconds: number;
  now: number;
  /** How many upcoming turns to list. */
  limit?: number;
}

interface Row {
  key: number;
  kind: string;
  time: string;
  height: string;
  next: boolean;
}

/** "today" / "tomorrow" / weekday, so a time is never ambiguous. */
function daySuffix(t: number, utcOffsetSeconds: number, now: number): string {
  const shift = (ms: number) => new Date(ms + utcOffsetSeconds * 1000);
  const at = shift(t);
  const today = shift(now);
  const days =
    (Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) -
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) /
    86_400_000;

  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    at.getUTCDay()
  ];
}

const columns: ColumnsType<Row> = [
  { title: 'Tide', dataIndex: 'kind', key: 'kind' },
  { title: 'Time', dataIndex: 'time', key: 'time', className: 'cell-big' },
  { title: 'Height', dataIndex: 'height', key: 'height', align: 'right', className: 'cell-big' },
];

/**
 * The next tide turns.
 *
 * A tide table is the artefact anglers have used for a century, so it is set
 * as one — tabular figures, heights signed against mean sea level. The heading
 * lives in the page, not here.
 */
export function TideTable({ extremes, utcOffsetSeconds, now, limit = 6 }: TideTableProps) {
  const upcoming = extremes.filter((e) => e.t >= now - 1800_000).slice(0, limit);

  const rows: Row[] = upcoming.map((e, i) => ({
    key: e.t,
    kind: e.kind === 'high' ? 'High' : 'Low',
    time: `${epochToSpotTime(e.t, utcOffsetSeconds)} ${daySuffix(e.t, utcOffsetSeconds, now)}`,
    height: `${e.height > 0 ? '+' : e.height < 0 ? '−' : ''}${Math.abs(e.height).toFixed(2)} m`,
    // The turn the angler is actually waiting for.
    next: i === 0,
  }));

  return (
    <div className="data-table">
      <Table<Row>
        columns={columns}
        dataSource={rows}
        pagination={false}
        size="small"
        rowClassName={(row) => (row.next ? 'is-now' : '')}
        // See WhenToGo: an empty state here is a sentence, not antd's stock
        // grey illustration.
        locale={{
          emptyText: (
            <p className="empty">
              No tide turns to list — this spot is too far inland for the wave model to
              reach, so there is no tide here, only wind and rain.
            </p>
          ),
        }}
      />
    </div>
  );
}
