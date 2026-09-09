import { divIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { LatLon } from '../api/types';

/** Roughly frames the Australian mainland and its coastal waters. */
const AUSTRALIA_CENTER: [number, number] = [-27.5, 134];
const AUSTRALIA_ZOOM = 4;

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

interface SpotMapProps {
  selected: LatLon | null;
  /** Ocean cell the marine data was drawn from, if it is meaningfully away. */
  anchor: LatLon | null;
  onPick: (p: LatLon) => void;
}

export function SpotMap({ selected, anchor, onPick }: SpotMapProps) {
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
      {selected && <Marker position={[selected.lat, selected.lon]} icon={pin} />}
      {anchor && <Marker position={[anchor.lat, anchor.lon]} icon={anchorPin} />}
    </MapContainer>
  );
}
