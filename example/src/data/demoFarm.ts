// EVERYTHING IN THIS FILE IS MADE UP.
// The shapes are drawn from metre offsets around an arbitrary point in open
// farmland; they are not traced from any real field. Names, crops, statuses
// and machines are invented for the demo.

import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { labelPoint, localFrame, ringAreaM2, M2_PER_ACRE, type Ring } from './geo';
import type { EquipmentKind } from '../map/equipmentIcons';

export const ORIGIN = { lat: 38.5, lng: -98.5 };
const f = localFrame(ORIGIN);

export type Crop = 'Corn' | 'Soybeans' | 'Wheat' | 'Sorghum';
export type Status = 'Harvested' | 'In progress' | 'Not started';

export interface FieldProps {
  id: string;
  name: string;
  crop: Crop;
  status: Status;
  acres: number;
  /** Precomputed label anchor (inside the polygon) and the room around it. */
  label: { lat: number; lng: number; roomM: number };
}

export type FieldFeature = Feature<Polygon, FieldProps>;
export type FieldCollection = FeatureCollection<Polygon, FieldProps>;

function field(id: string, name: string, crop: Crop, status: Status, ring: Ring): FieldFeature {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      id, name, crop, status,
      acres: Math.round(ringAreaM2(ring) / M2_PER_ACRE),
      label: labelPoint(ring),
    },
  };
}

export const FIELDS: FieldCollection = {
  type: 'FeatureCollection',
  features: [
    field('field-a', 'Field A', 'Corn', 'Not started', f.rect(0, 0, 800, 800)),
    // L-shaped on purpose: its centroid falls outside the shape, so the label
    // point has to come from the scan-line search in labelPoint().
    field('field-b', 'Field B', 'Soybeans', 'In progress',
      f.ring([[-900, 0], [-100, 0], [-100, 300], [-640, 300], [-640, 950], [-900, 950]])),
    field('north-40', 'North 40', 'Wheat', 'Harvested', f.rect(0, 900, 400, 1300)),
    field('pivot-3', 'Pivot 3', 'Corn', 'Harvested', f.circle(1000, 1250, 380)),
    field('south-80', 'South 80', 'Sorghum', 'Not started', f.rect(0, -500, 800, -100)),
    field('creek-bottom', 'Creek Bottom', 'Soybeans', 'Harvested',
      f.ring([[-900, -100], [-150, -100], [-120, -300], [-300, -520], [-600, -600], [-850, -480], [-950, -300]])),
  ],
};

/** An outline-only reference layer: a half-mile grid. */
export const GRID: FeatureCollection = (() => {
  const step = 805;
  const lines: Feature[] = [];
  for (let x = -1610; x <= 1610; x += step)
    lines.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [f.toLngLat(x, -1200), f.toLngLat(x, 2000)] } });
  for (let y = -805; y <= 1610; y += step)
    lines.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [f.toLngLat(-1700, y), f.toLngLat(1700, y)] } });
  return { type: 'FeatureCollection', features: lines };
})();

export interface Machine {
  id: string;
  name: string;
  kind: EquipmentKind;
  lat: number;
  lng: number;
  lastSeen: number; // epoch ms
}

const minutesAgo = (m: number) => Date.now() - m * 60_000;
const at = (x: number, y: number) => { const [lng, lat] = f.toLngLat(x, y); return { lat, lng }; };

export const MACHINES: Machine[] = [
  { id: 'combine-1', name: 'Combine 1', kind: 'combine', ...at(-770, 700), lastSeen: minutesAgo(1) },
  { id: 'cart-1', name: 'Grain cart tractor', kind: 'tractor', ...at(-480, 150), lastSeen: minutesAgo(3) },
  { id: 'sprayer-2', name: 'Sprayer 2', kind: 'sprayer', ...at(960, -250), lastSeen: minutesAgo(26) },
  { id: 'pickup-4', name: 'Pickup 4', kind: 'truck', ...at(-40, 850), lastSeen: minutesAgo(190) },
];

// ---- Colour modes and legends. One source of truth for map + legend. ----

export type ColorMode = 'crop' | 'status';

export const LEGENDS: Record<ColorMode, { title: string; items: { key: string; label: string; color: string }[] }> = {
  crop: {
    title: 'Crop',
    items: [
      { key: 'Corn', label: 'Corn', color: '#facc15' },
      { key: 'Soybeans', label: 'Soybeans', color: '#4ade80' },
      { key: 'Wheat', label: 'Wheat', color: '#fb923c' },
      { key: 'Sorghum', label: 'Sorghum', color: '#f87171' },
    ],
  },
  status: {
    title: 'Harvest status',
    items: [
      { key: 'Harvested', label: 'Harvested', color: '#22c55e' },
      { key: 'In progress', label: 'In progress', color: '#f59e0b' },
      { key: 'Not started', label: 'Not started', color: '#94a3b8' },
    ],
  },
};

export function fieldColor(p: FieldProps, mode: ColorMode): string {
  const key = mode === 'crop' ? p.crop : p.status;
  return LEGENDS[mode].items.find((i) => i.key === key)?.color ?? '#64748b';
}

export function totals(fc: FieldCollection) {
  const all = fc.features.map((x) => x.properties);
  const acres = all.reduce((s, p) => s + p.acres, 0);
  const done = all.filter((p) => p.status === 'Harvested').reduce((s, p) => s + p.acres, 0);
  const left = all.filter((p) => p.status !== 'Harvested').length;
  return { fields: all.length, acres, done, left };
}
