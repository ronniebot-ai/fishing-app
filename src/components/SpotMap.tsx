import { divIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { SavedSpot } from '../api/spots';
import type { LatLon } from '../api/types';

/** Roughly frames the Australian mainland and its coastal waters. */
const AUSTRALIA_CENTER: [number, number] = [-27.5, 134];
const AUSTRALIA_ZOOM = 4;

/** Close enough to see the ground a spot sits on when flying to one. */
const SPOT_ZOOM = 11;

/**
 * The picked spot, in the annotation colour — the one hot mark on the page,
 * matching the "now" line on the tide curve.
 *
 * Leaflet's default marker images break under bundlers because its CSS
 * references them by relative URL, so a divIcon sidesteps that and lets the
 * pin follow the palette.
 */
const pin = divIcon({
  className: '',
  html: `<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
    <circle cx="11" cy="11" r="5" fill="#F2617A"/>
    <circle cx="11" cy="11" r="10" fill="none" stroke="#F2617A" stroke-width="1.5" opacity="0.55"/>
  </svg>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/** Where the marine data actually came from, when that is somewhere else. */
const anchorPin = divIcon({
  className: '',
  html: `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="5.5" fill="none" stroke="#2FA5B8" stroke-width="2"/>
  </svg>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/**
 * A kept spot. Hollow and quiet: these are places to return to, not the place
 * being read, so they must not compete with the hot pin for attention.
 */
const savedPin = divIcon({
  className: '',
  html: `<svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="7" r="4" fill="none" stroke="#F2617A" stroke-width="1.5" opacity="0.85"/>
  </svg>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function ClickHandler({ onPick }: { onPick: (p: LatLon) => void }) {
  useMapEvents({
    click(e) {
      onPick({
        lat: Math.round(e.latlng.lat * 1e4) / 1e4,
        lon: Math.round(e.latlng.lng * 1e4) / 1e4,
      });
    },
  });
  return null;
}

/**
 * Leaflet caches its container size and only re-measures on a window resize.
 * This pane also changes size without one — the layout switches between
 * stacked and side-by-side at 900px, and phones resize on rotation — which
 * leaves unpainted grey bands. A ResizeObserver covers both cases.
 */
function ResizeWatcher() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/**
 * Brings the view to a spot chosen from somewhere other than the map.
 *
 * The map is otherwise left alone after mount — panning it is the user's, and
 * yanking the view back on every state change would fight them. So this reacts
 * to `focus`, which is set only by picking a saved spot, never by a map click.
 * A fresh object each time means choosing the same spot again still flies,
 * which is what someone who has panned away expects.
 */
function Recenter({ focus }: { focus: LatLon | null }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lon], Math.max(map.getZoom(), SPOT_ZOOM));
  }, [focus, map]);
  return null;
}

interface SpotMapProps {
  selected: LatLon | null;
  /** Ocean cell the marine data was drawn from, if it is meaningfully away. */
  anchor: LatLon | null;
  /** Kept spots, marked so they can be found again without the list. */
  saved: SavedSpot[];
  /** Somewhere to fly to, set by choosing a saved spot rather than clicking. */
  focus: LatLon | null;
  onPick: (p: LatLon) => void;
  onSelectSaved: (spot: SavedSpot) => void;
}

export function SpotMap({
  selected, anchor, saved, focus, onPick, onSelectSaved,
}: SpotMapProps) {
  return (
    <MapContainer
      center={selected ? [selected.lat, selected.lon] : AUSTRALIA_CENTER}
      zoom={selected ? 9 : AUSTRALIA_ZOOM}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <ClickHandler onPick={onPick} />
      <ResizeWatcher />
      <Recenter focus={focus} />

      {/* The one being read already has the hot pin; a second mark under it
          would only muddy which is which. */}
      {saved
        .filter((s) => s.lat !== selected?.lat || s.lon !== selected?.lon)
        .map((spot) => (
          <Marker
            key={spot.id}
            position={[spot.lat, spot.lon]}
            icon={savedPin}
            title={spot.name}
            alt={spot.name}
            eventHandlers={{ click: () => onSelectSaved(spot) }}
          />
        ))}

      {selected && <Marker position={[selected.lat, selected.lon]} icon={pin} />}
      {anchor && <Marker position={[anchor.lat, anchor.lon]} icon={anchorPin} />}
    </MapContainer>
  );
}
