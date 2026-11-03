# 04 · Icons: markers, clip art, tiles and the app icon

Our apps use four kinds of icons:

| Kind | Where | How |
|---|---|---|
| **Status dots** | Live equipment, sensors, vehicles | `CircleMarker`, coloured by state |
| **Badges, labels, clip art** | Value badges, names, emoji, rotation arrows, machine illustrations | `L.divIcon` with HTML or inline SVG |
| **Tile icons** | The Home catalog | 24×24 line-art SVG paths in React |
| **App icon set** | Home screen, favicon, browser tab, loading animation | Generated from one piece of artwork by a script |

None of our apps uses Leaflet's default blue PNG pin.

## 1. Status dots: `CircleMarker`

A `CircleMarker` is a vector dot. It's cheap to draw, it stays the same size at every zoom, and its colour carries the meaning.

```tsx
const STATUS_COLOR = { moving: '#22c55e', parked: '#f59e0b', offline: '#64748b' } as const;

function statusOf(lastSeen: string, speed: number) {
  const ageMin = (Date.now() - Date.parse(lastSeen)) / 60_000;
  if (ageMin > OFFLINE_AFTER_MIN) return 'offline';     // derive status from age, don't trust a stale flag
  return speed > 0.5 ? 'moving' : 'parked';
}

<CircleMarker
  center={[a.lat, a.lon]}
  radius={selected ? 10 : 6}
  pathOptions={{
    color: '#fff', weight: selected ? 3 : 1.5,           // white edge: contrast on satellite imagery
    fillColor: STATUS_COLOR[statusOf(a.lastSeen, a.speed)],
    fillOpacity: dimmed ? 0.15 : coarse ? 0.6 : 0.95,     // dim what's outside the active filter
    dashArray: coarse ? '3 3' : undefined,                // low-confidence fix (e.g. cell tower)
  }}
  eventHandlers={{ click: () => onSelect(a.id) }}
/>
```

- **Show low-confidence positions as dashed.** For something like a cell-tower fix, add a dashed `Circle` at the accuracy radius.
- **Stale items go gray or translucent.** Work out "offline" from the last-seen age.
- **Don't draw markers for missing coordinates.** Filter out `lat == null` and `lat === 0 && lng === 0` before making any marker, or you get a confident dot in the ocean.
- **Draw other people smaller than the user.** In a presence feed, drop your own entry, draw everyone else smaller and plainer than your own dot, and use `zIndexOffset={-500}` to keep their markers under yours.

## 2. Badges and labels: `L.divIcon`

A `divIcon` is a marker whose look is your own HTML. Use it for anything with text, emoji or custom art.

```ts
const badge = (text: string, bg: string) => L.divIcon({
  className: '',                     // removes Leaflet's default white square
  iconSize: [0, 0], iconAnchor: [0, 0],
  html: `<div style="transform:translate(-50%,-50%);background:${bg};padding:2px 8px;
           border-radius:8px;border:2px solid #fff;white-space:nowrap;color:#fff;
           text-shadow:0 0 3px #000,0 0 6px #000">${esc(text)}</div>`,
});
```

- **`iconSize: [0, 0]` plus `translate(-50%, -50%)`** centres variable-width HTML exactly on the point, with no measuring.
- **`className: ''`** removes Leaflet's default white box.
- **White text on satellite imagery needs a halo:** `text-shadow: 0 0 3px #000, 0 0 6px #000`. Emoji markers use `filter: drop-shadow(...)`.
- **Pure labels get `interactive: false`,** so taps reach the shape underneath.
- **Build icons in `useMemo`,** keyed on their data, not on every render.
- **Watch for drift.** A rendered divIcon sits on its line box, so inline content can drift about 4 px. Position inner spans absolutely at 0,0.

### Escape before you interpolate

`divIcon` `html` is set as `innerHTML`, so a name from the database goes straight into the page. That's harmless while only staff type names. As soon as any user-editable text (a nickname, a gauge name) reaches the map, it's a cross-site-scripting hole. Only our newest app escapes every string. The older ones should too, and so should yours from day one.

```ts
export const esc = (t: unknown) =>
  String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
```

The same applies to `bindTooltip(string)` and `bindPopup(string)`. React-rendered `<Tooltip>` and `<Popup>` children are escaped for you.

## 3. Machine clip art: your own SVG, drawn in code

The equipment layer in our field map shows live machine positions from a farm-equipment telematics API. Each machine appears as a small two-tone illustration (a tractor, an air-blast sprayer, a high-clearance sprayer, a baler, a combine) instead of a dot. Tapping one shows its name, model, "last seen 5m ago" and coordinates.

**How it's built:**

- **One function per kind.** Each returns SVG markup inside a 64×48 `viewBox`, with every machine facing left so they read as a set.
- **One palette object** holds the colours: body, dark, accent, wheel, hub, glass, spray.
- **Shared helpers** draw the repeated parts, such as a wheel (tyre plus hub).

```ts
type Palette = { body: string; dark: string; accent: string; wheel: string; hub: string; glass: string; spray: string };
export const PALETTE: Palette = {
  body: '#0f766e', dark: '#134e4a', accent: '#f59e0b', wheel: '#1f2937', hub: '#e5e7eb', glass: '#bae6fd', spray: '#60a5fa',
};

const wheel = (cx: number, cy: number, r: number, p: Palette) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.wheel}"/>` +
  `<circle cx="${cx}" cy="${cy}" r="${(r * 0.42).toFixed(1)}" fill="${p.hub}"/>`;

const tractor = (p: Palette) =>
  `<rect x="6" y="24" width="17" height="9" rx="2" fill="${p.body}"/>` +      // hood (faces left)
  `<rect x="4" y="25" width="3" height="6" rx="1" fill="${p.dark}"/>` +       // grille
  `<rect x="20" y="11" width="15" height="22" rx="2" fill="${p.body}"/>` +    // cab
  `<rect x="23" y="14" width="9" height="8" rx="1" fill="${p.glass}"/>` +     // window
  wheel(13, 35, 5.5, p) + wheel(30, 33, 9, p);                                // small front, big rear

const DRAW: Record<Kind, (p: Palette) => string> = { tractor, /* airBlastSprayer, highClearance, baler, combine */ };

export const iconHtml = (kind: Kind, w = 44, h = 33) =>
  `<svg width="${w}" height="${h}" viewBox="0 0 64 48" xmlns="http://www.w3.org/2000/svg">${DRAW[kind](PALETTE)}</svg>`;

export const equipmentIcon = (kind: Kind) => L.divIcon({
  className: 'equip-marker', iconSize: [0, 0],
  html: `<div style="transform:translate(-50%,-50%);filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))">${iconHtml(kind)}</div>`,
});
```

The marker has no text label. The art is enough at map scale, and the popup carries the details.

**Which picture? One classifier, most specific rule first.** Telematics feeds report a model string and a category, and the category is often too generic. A self-propelled sprayer that reports its category as "Tractor" must be matched by its model before the tractor fallback catches it.

```ts
type Kind = 'tractor' | 'airBlastSprayer' | 'highClearance' | 'baler' | 'combine';

const RULES: [RegExp, Kind][] = [
  [/high.?clearance|self.?propelled sprayer/i, 'highClearance'],   // most specific first
  [/air.?blast/i, 'airBlastSprayer'],
  [/baler/i, 'baler'],
  [/combine|harvester/i, 'combine'],
];

export function kindOf(model = '', category = ''): Kind {
  const s = `${model} ${category}`;
  return RULES.find(([re]) => re.test(s))?.[1] ?? 'tractor';      // generic fallback last
}
```

Keep the classifier in one place, so the legend and the markers always agree.

**The popup's "last seen":**

```ts
export function relTime(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
```

**Where the data comes from.** The server polls the vendor API every few minutes and stores positions in a `locations` table. The client only reads that table. It never talks to the vendor, so no vendor credentials ever reach the browser.

> **Draw your own silhouettes.** Don't copy a manufacturer's artwork or logo, or use their trademark colour scheme. Simple rectangles and circles read fine at 44 px.

## 4. Tile icons on the Home catalog

Each Home tile has an icon key (`"field"`, `"drop"`, `"pin"`…). The client maps each key to 24×24 line-art SVG paths, drawn in the tile's colour on a tinted square:

```tsx
const ICONS: Record<string, React.ReactNode> = {
  field: <path d="M3 17l6-10 4 6 3-4 5 8H3z" />,
  drop:  <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" />,
  pin:   <><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></>,
};

function TileIcon({ name, color }: { name: string; color: string }) {
  return (
    <span className="grid h-11 w-11 place-items-center rounded-xl" style={{ background: `${color}26` }}>
      {/* "26" hex alpha ≈ 15% of the tile colour */}
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke={color}
           strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {ICONS[name] ?? ICONS.pin}
      </svg>
    </span>
  );
}
```

The server sends only the key and the colour. The artwork lives in the client.

## 5. Colour that means something

- **A ramp helper** returns the colour of the highest threshold a value reaches:

```ts
const ramp = (stops: [number, string][], v: number | null) =>
  v == null ? '#64748b' : stops.reduce((c, [t, col]) => (v >= t ? col : c), stops[0][1]);
const TEMP = (v: number | null) => ramp([[-Infinity, '#1e3a8a'], [32, '#3b82f6'], [65, '#22c55e'], [88, '#f97316'], [98, '#ef4444']], v);
```

- **One config per attribute** (`{ label, unit, digits, color(v), textColor(v) }`), so a dropdown can switch what the badges show.
- **"Days since" maps** use calendar-day tiers: today blue → yesterday green → 3 days yellow → 4 orange → 5–9 red → 10+ purple. Recent items get a higher fill opacity.
- **Categories with no fixed list** hash the name to a hue, so the colour stays the same across renders and sessions:

```ts
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 70% 55%)`; };
```

- **Admin-editable colours** (an equipment-type colour picker, say) live in a lookup table in the database.
- **Classes from the data file.** Colour classes can come from the data itself (`meta.classes`, docs/06), mapped onto a ramp in order, with a neutral colour for the zero class.
- **Compute "days since" in local calendar days.** `new Date().toISOString().slice(0, 10)` is UTC, and it logged evening entries as tomorrow. Parse `YYYY-MM-DD` as local midnight, and pin one farm time zone if people travel.

## 6. The app icon set, generated from one piece of art

The app installs to iOS and Android home screens, so it needs a full icon set. We generate every size from one source image with a script, and never hand-edit an icon.

A Python script (Pillow only) in `tools/brand/` reads `source/` and writes `client/public/*.png` and `client/src/assets/*.webp`. Give it its own virtual environment: `python3 -I` ignores your user packages, and Homebrew's Python refuses a global `pip install`, so a bare `python3 -I` gets `ImportError: No module named PIL`:

```sh
python3 -m venv tools/brand/.venv && tools/brand/.venv/bin/pip install pillow     # once; .venv/ is gitignored
tools/brand/.venv/bin/python -I tools/brand/icons.py source/icon.png client/public client/src/assets
```

| Output | Size | Notes |
|---|---|---|
| `icon-1024.png`, `icon-512.png`, `icon-192.png` | full-bleed squares | For the manifest's "any" purpose |
| `maskable-512.png` | 512 | Art inside the central safe zone (about 80%) on a solid background |
| `apple-touch-icon.png` | 180 | iOS home screen |
| `favicon-16.png`, `favicon-32.png` | 16, 32 | Keep their own anti-aliased rounded corners on a transparent background |
| `logo-96.webp` | 96 (~5 KB) | The in-app Home button and logo |

```python
# tools/brand/.venv/bin/python -I tools/brand/icons.py source/icon.png client/public client/src/assets
import sys
from PIL import Image

src, public, assets = sys.argv[1:4]
square = Image.open(src).convert('RGBA')          # already cropped to a full-bleed square

for name, s in (('icon-1024.png', 1024), ('icon-512.png', 512), ('icon-192.png', 192),
                ('apple-touch-icon.png', 180)):
    square.resize((s, s), Image.LANCZOS).save(f'{public}/{name}', optimize=True)

# maskable: art at 80% on a solid background, so any platform mask leaves it whole
bg = Image.new('RGBA', (512, 512), square.getpixel((2, 2)))
art = square.resize((410, 410), Image.LANCZOS)
bg.paste(art, (51, 51), art)
bg.save(f'{public}/maskable-512.png', optimize=True)

square.resize((96, 96), Image.LANCZOS).save(f'{assets}/logo-96.webp', quality=90)
```

Our real script does more, because the source art was a glossy rounded tile on white:

- It finds the tile by flood-filling the white surround.
- It crops inside the glossy bevel, so no light rim shows under iOS's own rounding.
- It fills the leftover corners from the art itself, using repeated masked Gaussian blurs at growing radii.

**Keep PNG icons full colour.** A 256-colour palette makes gradients blotchy.

**The manifest and HTML head:**

```json
{
  "id": "/", "start_url": "/", "scope": "/", "display": "standalone",
  "name": "Farm Maps", "short_name": "Maps",
  "theme_color": "#111827", "background_color": "#111827",
  "icons": [
    { "src": "/icon-192.png?v=3",     "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png?v=3",     "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/maskable-512.png?v=3", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

```html
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=3">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=3">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png?v=3">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

**Changing the icon later.** Bump `?v=N` on every icon URL so browsers fetch the new set. Each platform then behaves differently:

- Android Chrome picks up the new icon by itself once the manifest's icon URLs change.
- iOS keeps the old home-screen icon until the app is removed and added again.
- An Android Trusted Web Activity (an app-store wrapper around the PWA) keeps its built-in icon until the APK is rebuilt.

**The Android store wrapper** needs a Digital Asset Links file served from your origin at `/.well-known/assetlinks.json`. Put it in `client/public/.well-known/`. It holds your package name and signing-certificate fingerprint, and those are yours, so don't copy someone else's:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": { "namespace": "android_app", "package_name": "com.example.maps",
              "sha256_cert_fingerprints": ["<YOUR:SIGNING:CERT:SHA256>"] }
}]
```

## 7. The loading animation

The same tools folder turns an animated GIF into a transparent animated WebP loader. For each frame, the script:

1. Estimates the background colour from the edge columns.
2. Keeps the largest connected shape that differs from the background, dropping stray pixels.
3. Fills holes in that shape.
4. Makes a 3 px band along its edge partly transparent, so it blends onto any background.
5. Drops anything darker than the background. That removes the baked-in shadow; CSS adds a drop shadow back.

The result is saved as an animated WebP at 400 px wide (about 200 KB) and shown at 200 px, plus one still frame for people who've asked for reduced motion:

```html
<picture>
  <source srcset="/loader-still.webp" media="(prefers-reduced-motion: reduce)">
  <img src="/loader.webp" width="200" alt="Loading" style="filter:drop-shadow(0 4px 8px rgba(0,0,0,.35))">
</picture>
```

Show it on the boot screen and while redirecting to sign-in, instead of a bare "Loading…".
