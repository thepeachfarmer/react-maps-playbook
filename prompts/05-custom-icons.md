# 05 · Custom icons

**Use it when:** you want map markers that look like the real things (machines, pumps, gauges), status dots, Home tile icons, or a proper app icon set.
**Fill in:** `<kinds>` (tractor, sprayer, truck…), `<data source>` for positions, `<source-art.png>` for the app icon.
**Read first:** `docs/playbook/04-icons.md`.

```text
Goal
Give the app proper icons. Do the parts I list here and skip the rest:
[ ] A. Map markers for <kinds>, drawn as our own two-tone SVG clip art, for positions from <data source>.
[ ] B. Status dots (CircleMarker) coloured by moving / parked / offline.
[ ] C. Line-art SVG icons for the Home tiles.
[ ] D. The full app icon set generated from <source-art.png> by a script.
Read docs/playbook/04-icons.md first.

What to build
A. client/src/map/equipmentIcons.ts:
   - One function per kind returning SVG markup in a 64x48 viewBox, every machine facing left.
   - One PALETTE object (body, dark, accent, wheel, hub, glass, spray) and shared helpers (wheel(cx, cy, r)).
   - A kindOf(model, category) classifier with the MOST SPECIFIC rule first and a generic fallback last.
     The legend uses the same classifier.
   - A marker as L.divIcon({className:'equip-marker', iconSize:[0,0]}), its HTML wrapping the SVG in a div
     with transform:translate(-50%,-50%) and filter:drop-shadow(...). Build icons in useMemo.
   - A popup with name, model, "last seen" via relTime() ("just now", "5m ago", "3h ago", "2d ago"), and
     coordinates. All strings through esc().
   - Draw original, simple silhouettes. Do not copy any manufacturer's artwork, logo or trademark colours.
B. Status: derive the status from last_seen age (offline after <N> minutes), white 1.5px stroke, bigger when
   selected, dashed for low-confidence positions. Skip null or (0,0) coordinates.
C. client/src/ui/tileIcons.tsx: Record<string, ReactNode> of 24x24 stroke paths; TileIcon draws one in the
   tile colour on a ~15%-alpha background of that colour. The server sends only the key and the colour.
D. tools/brand/icons.py (Pillow only, in its own venv, because python3 -I ignores user packages and
   Homebrew's Python refuses a global pip install):
     python3 -m venv tools/brand/.venv && tools/brand/.venv/bin/pip install pillow
     tools/brand/.venv/bin/python -I tools/brand/icons.py <source-art.png> client/public client/src/assets
   It writes icon-1024/512/192.png, maskable-512.png (art inside the central ~80% on a solid background),
   apple-touch-icon.png (180), favicon-16/32.png and a 96px WebP logo. Update manifest.webmanifest and
   index.html with ?v=<N> on every icon URL. Keep PNGs full colour (no 256-colour palette). .venv/ is
   gitignored. Add tools/brand/README.md with those two commands.

Constraints
- No icon fonts, no default Leaflet PNG pins.
- The SVG must look right at 44x33 on satellite imagery: check contrast.
- Don't commit the source art if it isn't yours to publish (keep it in inbox/ and say so in the README).

Acceptance checks
- Each kind renders, is centred exactly on its point at every zoom, and has no white square behind it.
- The legend shows the same picture as the marker for every kind.
- A machine name containing <script> shows as text.
- Lighthouse (or the browser's Application panel) shows a valid manifest with "any" and "maskable" icons.
- Running the icon script twice produces identical files (compare shasum).

How to verify (show me)
- A screenshot at 390x844 zoomed in on markers of each kind, and one with a popup open.
- A contact-sheet image in outbox/ showing every generated icon size side by side.
- The build output.
```
