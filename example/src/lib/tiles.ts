// OpenStreetMap's standard tiles are fine for a demo and light use. They need
// visible attribution, and heavy or commercial use must move to your own tile
// server or a provider (see the OSM tile usage policy). Swap with VITE_TILE_URL.
export const TILE_URL = import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = import.meta.env.VITE_TILE_ATTRIBUTION
  || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// The same credit as plain text, for the small print in the drawer and the list.
// Derived, not hard-coded, so it stays right when VITE_TILE_URL points elsewhere.
export const TILE_CREDIT = TILE_ATTRIBUTION.replace(/<[^>]*>/g, '')
  .replace(/&copy;/g, '\u00a9').replace(/&amp;/g, '&').trim();
