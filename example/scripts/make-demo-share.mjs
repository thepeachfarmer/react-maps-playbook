// Writes public/shares/demo-plan.geojson: an invented pipe layout for the
// demo's "Field A". Run with `npm run make-share`.
//
// It follows the data-pipeline rules from the playbook, in miniature:
//   - the output is plain GeoJSON the viewer draws from feature properties,
//   - coordinates are rounded to 6 decimals and features come out in a fixed
//     order, so rebuilding gives a byte-identical file (diffs stay readable),
//   - compact JSON (no pretty-printing) to keep the file small.
// Nothing here comes from a real field.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ORIGIN = { lat: 38.5, lng: -98.5 };
const KX = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const KY = 110540;
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const ll = (x, y) => [r6(ORIGIN.lng + x / KX), r6(ORIGIN.lat + y / KY)];

const feature = (geometry, properties) => ({ type: 'Feature', properties, geometry });
const line = (pts, props) => feature({ type: 'LineString', coordinates: pts.map(([x, y]) => ll(x, y)) }, props);
const point = (x, y, props) => feature({ type: 'Point', coordinates: ll(x, y) }, props);

const features = [
  feature(
    { type: 'Polygon', coordinates: [[[0, 0], [800, 0], [800, 800], [0, 800], [0, 0]].map(([x, y]) => ll(x, y))] },
    { layer: 'field', group: 'Field boundary', name: 'Field A', stroke: '#0f172a', stroke_width: 2, fill: '#86efac', fill_opacity: 0.25 },
  ),
  line([[-40, 400], [760, 400]], { layer: 'pipe', group: 'Mainline', name: 'Mainline', note: 'Buried mainline (invented).', stroke: '#1d4ed8', stroke_width: 5 }),
  ...[100, 300, 500, 700].map((x, i) =>
    line([[x, 40], [x, 760]], { layer: 'pipe', group: 'Lateral (proposed)', name: `Lateral ${i + 1}`, note: 'Proposed lateral.', stroke: '#0ea5e9', stroke_width: 3, dash: '8 6' })),
  point(-40, 400, { layer: 'poi', group: 'Pump', name: 'Pump', note: 'Proposed pump site.', fill: '#ef4444' }),
  ...[100, 300, 500, 700].map((x, i) => point(x, 400, { layer: 'poi', group: 'Valve', name: `Valve ${i + 1}`, fill: '#f59e0b' })),
  point(400, 640, { layer: 'label', label: 'Field A' }),
];

const fc = { type: 'FeatureCollection', kind: 'plan', meta: { title: 'Demo pipe plan', source: 'invented' }, features };
const out = fileURLToPath(new URL('../public/shares/demo-plan.geojson', import.meta.url));
writeFileSync(out, JSON.stringify(fc) + '\n');
console.log(`wrote ${out} (${features.length} features)`);
