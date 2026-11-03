// Field labels that never overlap each other, a machine icon or any UI.
//
// Screen-space greedy placement, re-run on every moveend / zoomend / resize
// and whenever the chrome changes size:
//   1. seed a list of "taken" rectangles with every visible piece of UI
//      (bar, chip, legend, list panel, Leaflet controls), padded 4px,
//   2. add the machine icons (pins always win),
//   3. biggest field first, try a few spots near its label point, for a long
//      form ("North 40 · 40 ac") and then a short one ("North 40"),
//   4. accept the first spot that is wholly on screen and hits nothing.
// A label must sit inside its own field (centre and all four edge midpoints),
// so it can't end up on a neighbour and read as theirs; if it doesn't fit at
// this zoom it is skipped, and appears when you zoom in.
// Box sizes are estimated from the character count, so nothing is measured.

import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import type { FieldCollection } from '../data/demoFarm';
import type { Ring } from '../data/geo';
import { CHROME_EVENT, chromeRects, type Rect } from '../lib/chrome';
import { esc } from '../lib/esc';

// Offsets in units of the label's own width / height. The first three keep
// the anchor inside the box horizontally; the last two nudge sideways.
const NEAR: [number, number][] = [[0, 0], [0, -1.1], [0, 1.1], [-0.3, 0], [0.3, 0]];

/** Ray-casting point-in-polygon on a [lng, lat] ring. */
function inRing(ring: Ring, lng: number, lat: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function LabelsLayer({ fields, pins }: { fields: FieldCollection; pins: { lat: number; lng: number }[] }) {
  const map = useMap();

  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    let raf = 0;

    const place = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        group.clearLayers();
        const size = map.getSize();
        const short = size.y < 500;
        const fs = short ? 11 : 12;
        const h = fs + 8;
        const mpp = (156543.03392 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** map.getZoom();

        const placed: Rect[] = chromeRects(map, true).map(({ rect: [l, t, r, b] }) => [l - 4, t - 4, r + 4, b + 4]);
        for (const p of pins) {
          const pt = map.latLngToContainerPoint(p);
          placed.push([pt.x - 24, pt.y - 18, pt.x + 24, pt.y + 18]);
        }
        const hits = (r: Rect) => placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
        const onScreen = (r: Rect) => r[0] >= 4 && r[1] >= 4 && r[2] <= size.x - 4 && r[3] <= size.y - 4;

        const order = [...fields.features].sort((a, b) => b.properties.acres - a.properties.acres);
        for (const f of order) {
          const { name, acres, label } = f.properties;
          const ring = f.geometry.coordinates[0] as Ring;
          const within = (x: number, y: number) => {
            const ll = map.containerPointToLatLng([x, y]);
            return inRing(ring, ll.lng, ll.lat);
          };
          const pt = map.latLngToContainerPoint([label.lat, label.lng]);
          const roomPx = label.roomM / mpp;
          placing: for (const text of [`${name} · ${acres} ac`, name]) {
            const w = Math.ceil(text.length * fs * 0.6 + 14);
            if (w > roomPx + 12) continue; // wider than the field here
            for (const [dx, dy] of NEAR) {
              const x = pt.x + dx * w;
              const y = pt.y + dy * h;
              const r: Rect = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
              if (!onScreen(r) || hits(r)) continue;
              if (![[x, y], [x, r[1] + 2], [x, r[3] - 2], [r[0] + 4, y], [r[2] - 4, y]].every(([px, py]) => within(px, py))) continue;
              placed.push(r);
              group.addLayer(
                L.marker(map.containerPointToLatLng([x, y]), {
                  interactive: false,
                  keyboard: false,
                  icon: L.divIcon({
                    className: 'map-label',
                    iconSize: [0, 0],
                    html: `<span style="font-size:${fs}px">${esc(text)}</span>`,
                  }),
                }),
              );
              break placing;
            }
          }
        }
      });
    };

    place();
    map.on('moveend zoomend resize', place);
    window.addEventListener(CHROME_EVENT, place);
    window.addEventListener('orientationchange', place);
    return () => {
      cancelAnimationFrame(raf);
      map.off('moveend zoomend resize', place);
      window.removeEventListener(CHROME_EVENT, place);
      window.removeEventListener('orientationchange', place);
      group.remove();
    };
  }, [map, fields, pins]);

  return null;
}
