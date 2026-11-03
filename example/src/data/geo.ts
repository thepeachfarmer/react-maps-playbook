// Tiny flat-earth helpers. Good enough for a few kilometres; use a real
// projection (or PostGIS in a projected CRS) for anything bigger.

export type LngLat = [number, number]; // GeoJSON order: [lng, lat]
export type Ring = LngLat[];

const M_PER_DEG_LAT = 110_540;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Build a converter from local metres (x east, y north) to [lng, lat]. */
export function localFrame(origin: { lat: number; lng: number }) {
  const kx = mPerDegLng(origin.lat);
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6; // 6 decimals ~ 10 cm
  const toLngLat = (x: number, y: number): LngLat => [r6(origin.lng + x / kx), r6(origin.lat + y / M_PER_DEG_LAT)];
  const close = (r: Ring): Ring => [...r, r[0]];
  return {
    toLngLat,
    /** Polygon ring from a list of [x, y] metre points (closed for you). */
    ring: (pts: [number, number][]) => close(pts.map(([x, y]) => toLngLat(x, y))),
    rect: (x0: number, y0: number, x1: number, y1: number) =>
      close([toLngLat(x0, y0), toLngLat(x1, y0), toLngLat(x1, y1), toLngLat(x0, y1)]),
    circle: (cx: number, cy: number, r: number, n = 64) =>
      close(Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return toLngLat(cx + r * Math.cos(a), cy + r * Math.sin(a));
      })),
  };
}

/** Planar area of a [lng, lat] ring in square metres (shoelace in a local frame). */
export function ringAreaM2(ring: Ring): number {
  const lat0 = ring[0][1];
  const kx = mPerDegLng(lat0);
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = [ring[i][0] * kx, ring[i][1] * M_PER_DEG_LAT];
    const [x1, y1] = [ring[i + 1][0] * kx, ring[i + 1][1] * M_PER_DEG_LAT];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a / 2);
}

export const M2_PER_ACRE = 4046.8564;

/**
 * A label point that is inside the polygon even when the centroid is not
 * (L-shaped or curved fields). Works in a local flat frame:
 *  1. area-weighted centroid,
 *  2. a horizontal scan line at the centroid's latitude,
 *  3. keep the centroid if it sits inside one of the inside stretches,
 *     otherwise use the middle of the widest stretch.
 * `roomM` is the width of the stretch the point sits in. The label layer
 * uses it to decide whether a label of N pixels fits at the current zoom.
 */
export function labelPoint(ring: Ring): { lat: number; lng: number; roomM: number } {
  const lat0 = ring[0][1];
  const kx = mPerDegLng(lat0);
  const pts = ring.map(([lng, lat]) => [lng * kx, lat * M_PER_DEG_LAT] as const);

  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  a /= 2;
  cx /= 6 * a;
  cy /= 6 * a;

  const xs: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (y0 <= cy !== y1 <= cy) xs.push(x0 + ((cy - y0) * (x1 - x0)) / (y1 - y0));
  }
  xs.sort((p, q) => p - q);

  let best: [number, number] | null = null;
  let inside: [number, number] | null = null;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const span: [number, number] = [xs[i], xs[i + 1]];
    if (cx >= span[0] && cx <= span[1]) inside = span;
    if (!best || span[1] - span[0] > best[1] - best[0]) best = span;
  }
  const span = inside ?? best;
  const x = inside ? cx : span ? (span[0] + span[1]) / 2 : cx;
  return { lng: x / kx, lat: cy / M_PER_DEG_LAT, roomM: span ? span[1] - span[0] : 0 };
}
