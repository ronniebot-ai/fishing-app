import { useState } from 'react';
import { SPOT_NAME_MAX, type SavedSpot } from '../api/spots';
import type { LatLon } from '../api/types';
import { formatLatLon } from '../domain/units';

interface SavedSpotsProps {
  spots: SavedSpot[];
  /** The spot the readings are currently for, saved or not. */
  selected: LatLon | null;
  onSelect: (spot: SavedSpot) => void;
  onRename: (id: number, name: string) => void;
  onRemove: (id: number) => void;
}

/**
 * The kept spots.
 *
 * Each row is a button first — the reason to have the list is to get back to a
 * spot — with editing behind it. Removing takes two presses rather than a
 * dialog: a confirm box over a map is a heavier interruption than the mistake
 * it prevents, and the second press is right where the first one was.
 */
export function SavedSpots({ spots, selected, onSelect, onRename, onRemove }: SavedSpotsProps) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<number | null>(null);

  if (spots.length === 0) return null;

  const commit = (id: number) => {
    const name = draft.trim();
    // An empty field means "leave it alone", not "clear the name".
    if (name) onRename(id, name);
    setEditing(null);
  };

  return (
    <section className="saved-spots" aria-label="Saved spots">
      <h2>Saved spots</h2>
      <ul>
        {spots.map((spot) => {
          const current = selected?.lat === spot.lat && selected?.lon === spot.lon;

          return (
            <li key={spot.id} data-current={current}>
              {editing === spot.id ? (
                <form
                  className="rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    commit(spot.id);
                  }}
                >
                  <input
                    type="text"
                    value={draft}
                    maxLength={SPOT_NAME_MAX}
                    aria-label={`Rename ${spot.name}`}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setEditing(null);
                    }}
                  />
                  <button type="submit">Save</button>
                  <button type="button" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="go"
                    aria-current={current || undefined}
                    onClick={() => onSelect(spot)}
                  >
                    <span className="name">{spot.name}</span>
                    <span className="at">{formatLatLon(spot.lat, spot.lon)}</span>
                  </button>

                  <button
                    type="button"
                    className="edit"
                    onClick={() => {
                      setEditing(spot.id);
                      setDraft(spot.name);
                      setConfirming(null);
                    }}
                  >
                    Rename
                  </button>

                  <button
                    type="button"
                    className="drop"
                    onClick={() => {
                      if (confirming === spot.id) {
                        onRemove(spot.id);
                        setConfirming(null);
                      } else {
                        setConfirming(spot.id);
                      }
                    }}
                    onBlur={() => setConfirming((id) => (id === spot.id ? null : id))}
                  >
                    {confirming === spot.id ? 'Sure?' : 'Remove'}
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
