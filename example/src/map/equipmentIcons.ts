// Home-made SVG "clip art" for equipment markers.
// Each kind draws inside a 64x48 viewBox, facing left, from one shared palette.
// Draw your own silhouettes; don't copy a manufacturer's artwork or livery.

import L from 'leaflet';

export type EquipmentKind = 'tractor' | 'sprayer' | 'combine' | 'truck';

const P = {
  body: '#0e7490',
  dark: '#164e63',
  accent: '#f59e0b',
  wheel: '#1f2937',
  hub: '#cbd5e1',
  glass: '#bae6fd',
};

const wheel = (cx: number, cy: number, r: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${P.wheel}"/>` +
  `<circle cx="${cx}" cy="${cy}" r="${(r * 0.42).toFixed(1)}" fill="${P.hub}"/>`;

const cab = (x: number, y: number, w: number, h: number) =>
  `<rect x="${x - 2}" y="${y - 3}" width="${w + 4}" height="3" rx="1" fill="${P.dark}"/>` +
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${P.glass}" stroke="${P.dark}" stroke-width="2"/>`;

const DRAW: Record<EquipmentKind, () => string> = {
  tractor: () =>
    `<rect x="7" y="24" width="22" height="10" rx="2" fill="${P.body}"/>` +
    `<rect x="18" y="13" width="2.5" height="11" fill="${P.dark}"/>` +
    `<rect x="27" y="19" width="17" height="15" rx="2" fill="${P.body}"/>` +
    cab(30, 7, 13, 13) +
    wheel(15, 37, 7) + wheel(39, 34, 11),
  sprayer: () =>
    `<rect x="6" y="25" width="50" height="4" rx="1" fill="${P.dark}"/>` +
    `<rect x="25" y="12" width="26" height="13" rx="6" fill="${P.body}"/>` +
    `<rect x="54" y="6" width="3" height="22" rx="1" fill="${P.accent}"/>` +
    cab(8, 11, 13, 13) +
    `<rect x="12" y="28" width="4" height="6" fill="${P.dark}"/><rect x="45" y="28" width="4" height="6" fill="${P.dark}"/>` +
    wheel(14, 39, 6.5) + wheel(47, 39, 6.5),
  combine: () =>
    `<rect x="1" y="30" width="15" height="8" rx="1" fill="${P.accent}"/>` +
    `<circle cx="8" cy="28" r="5" fill="none" stroke="${P.dark}" stroke-width="2"/>` +
    `<rect x="14" y="13" width="42" height="22" rx="3" fill="${P.body}"/>` +
    `<rect x="31" y="8" width="21" height="6" rx="1" fill="${P.dark}"/>` +
    `<path d="M50 10 L62 3" stroke="${P.dark}" stroke-width="3" stroke-linecap="round"/>` +
    cab(15, 4, 13, 11) +
    wheel(25, 37, 9) + wheel(49, 39, 6),
  truck: () =>
    `<path d="M13 24 L19 12 H34 V24 Z" fill="${P.body}"/>` +
    `<path d="M17.5 22 L21.5 15 H31 V22 Z" fill="${P.glass}"/>` +
    `<rect x="4" y="23" width="56" height="11" rx="3" fill="${P.body}"/>` +
    `<rect x="36" y="20" width="24" height="4" rx="1" fill="${P.dark}"/>` +
    wheel(16, 36, 6) + wheel(48, 36, 6),
};

export const KIND_LABEL: Record<EquipmentKind, string> = {
  tractor: 'Tractor',
  sprayer: 'Sprayer',
  combine: 'Combine',
  truck: 'Pickup',
};

/** Raw SVG markup, for the legend and the list as well as the markers. */
export function equipmentSvg(kind: EquipmentKind, w = 44, h = 33): string {
  return `<svg width="${w}" height="${h}" viewBox="0 0 64 48" aria-hidden="true">${DRAW[kind]()}</svg>`;
}

/**
 * A divIcon that centres variable-size HTML on the point:
 * iconSize [0,0] + an inner element translated by -50%/-50% (see .equip-icon
 * in styles.css). className keeps Leaflet's default white box away.
 */
export function equipmentIcon(kind: EquipmentKind): L.DivIcon {
  return L.divIcon({
    className: 'equip-marker',
    iconSize: [0, 0],
    html: `<div class="equip-icon">${equipmentSvg(kind)}</div>`,
  });
}

/** 'just now', '5m ago', '3h ago', '2d ago' */
export function relTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
