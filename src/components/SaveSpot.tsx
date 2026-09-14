import { useState } from 'react';
import { SPOT_NAME_MAX, type SavedSpot } from '../api/spots';
import type { LatLon } from '../api/types';
import { formatLatLon } from '../domain/units';

interface SaveSpotProps {
  spot: LatLon;
  /** The saved entry for this spot, when it has already been kept. */
  saved: SavedSpot | null;
  saving: boolean;
  /** Why the last save was refused, shown next to the button. */
  error: Error | null;
  /** Called with `undefined` when the field is empty: the server names it. */
  onSave: (name?: string) => void;
}

/**
 * Keeping the spot on screen.
 *
 * Naming is optional on purpose. Most spots are picked, read, and left — the
 * few worth keeping are worth one press, and the ones worth a name can have
 * one later from the list. An empty field is not an error, it is the common
 * case, so the button never waits on it.
 */
export function SaveSpot({ spot, saved, saving, error, onSave }: SaveSpotProps) {
  const [name, setName] = useState('');

  if (saved) {
    return (
      <p className="save-spot kept">
        <span className="kept-name">{saved.name}</span>
        <span className="kept-note">is saved</span>
      </p>
    );
  }

  return (
    <form
      className="save-spot"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(name.trim() || undefined);
        setName('');
      }}
    >
      <input
        type="text"
        value={name}
        maxLength={SPOT_NAME_MAX}
        placeholder={`Name ${formatLatLon(spot.lat, spot.lon)} (optional)`}
        aria-label="Name this spot"
        onChange={(event) => setName(event.target.value)}
      />
      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save spot'}
      </button>
      {error && (
        <span className="save-error" role="alert">
          {error.message}
        </span>
      )}
    </form>
  );
}
