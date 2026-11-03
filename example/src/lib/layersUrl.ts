// Layer toggles live in the query string (?layers=fields,labels&color=crop),
// so Back, refresh and a shared link all reopen the same view. The URL is the
// single source of truth; toggling rewrites it with replaceState, so no
// history entries pile up.

import type { ColorMode } from '../data/demoFarm';

export type LayerKey = 'fields' | 'labels' | 'equipment' | 'grid';
const ALL: LayerKey[] = ['fields', 'labels', 'equipment', 'grid'];
const DEFAULT: LayerKey[] = ['fields', 'labels', 'equipment'];

export function parseView(search: string): { layers: Set<LayerKey>; mode: ColorMode } {
  const q = new URLSearchParams(search);
  const raw = q.get('layers');
  const layers = new Set<LayerKey>(
    raw === null ? DEFAULT : raw.split(',').filter((k): k is LayerKey => (ALL as string[]).includes(k)),
  );
  const mode: ColorMode = q.get('color') === 'status' ? 'status' : 'crop';
  return { layers, mode };
}

export function viewHref(layers: Set<LayerKey>, mode: ColorMode): string {
  const q = new URLSearchParams();
  const list = ALL.filter((k) => layers.has(k));
  if (list.join() !== DEFAULT.join()) q.set('layers', list.join(','));
  if (mode !== 'crop') q.set('color', mode);
  const s = q.toString().replace(/%2C/g, ',');
  return s ? `/?${s}` : '/';
}
