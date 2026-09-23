import { RANGES, type RangeKey } from '../domain/range';

interface RangePickerProps {
  range: RangeKey;
  onChange: (next: RangeKey) => void;
}

/**
 * How much of the forecast to show at once.
 *
 * Hand-written buttons rather than antd's `Segmented` for the two reasons
 * every other control here is hand-written: the app's own controls all are,
 * and `DataTables` is lazy-loaded precisely because antd's widgets are heavy —
 * importing one into `App.tsx` would put it back in the main chunk.
 */
export function RangePicker({ range, onChange }: RangePickerProps) {
  return (
    <div className="range-picker" role="group" aria-label="How much time to show">
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          data-current={r.key === range}
          aria-pressed={r.key === range}
          onClick={() => onChange(r.key)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
