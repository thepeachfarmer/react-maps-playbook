# 02 · Add a layer

**Use it when:** you want a new set of things on the map (shapes, points or lines) that people can switch on and off.
**Fill in:** `<layer-name>`, `<what it shows>`, `<data source>` (an API route, or a GeoJSON file in `data/maps/`), `<colour>`, `<how to colour it>`.
**Read first:** `docs/playbook/02-the-map-page.md` sections 4, 6, 9 and 13.

```text
Goal
Add a new map layer called "<layer-name>" that shows <what it shows>, from <data source>.
It needs its own on/off switch, a legend, tooltips, and labels when zoomed in.
Read docs/playbook/02-the-map-page.md sections 4, 6, 9 and 13 first, then tell me your plan.

What to build
- A layer component inside MapContainer (client/src/components/layers/<LayerName>Layer.tsx) that uses
  useMap() and its own L.layerGroup() (or react-leaflet <GeoJSON>), redraws when its data or the zoom
  changes, and removes itself on unmount.
- Style: <colour> outline; fill by <how to colour it>. If it's a reference layer that sits over other layers,
  make it outline-only (fill:false) so it doesn't swallow taps.
- Tooltips: sticky:true, with every string run through esc().
- Labels: non-interactive L.divIcon labels with the 8-direction text-shadow halo, shown only from zoom 14
  up. Use precomputed label points if the data has them; otherwise a point guaranteed inside the polygon
  (docs section 9), not the corner average.
- A LayerToggle row (role="switch", aria-checked) whose accent bar and track use the same colour as the
  layer's outline on the map. Put it where the other layer switches live (the Layers drawer, if it exists).
- A legend from one shared table (client/src/shared/legends.ts) that the colouring code also imports, so
  they can't drift apart.
- The switch state goes in the ?layers= URL param, next to the existing layers.
- If the data is heavy, fetch it the first time the switch is turned on, not at page load, and start it off.
- If the layer only draws above some zoom, show "Zoom in to show them" under the switch when it's on but
  hidden.
- If it needs its own depth (above fields, under markers), give it a custom pane with
  map.getPane(name) || map.createPane(name), and decide on pointer-events.

Constraints
- Don't change how existing layers look or behave.
- No new dependencies unless you ask me first.
- GeoJSON is [lng, lat], Leaflet is [lat, lng]. Swap deliberately.
- If the data has new properties, document them in the tool's FORMAT.md (or in a comment next to the type).

Acceptance checks
- The switch turns the layer on and off. Refresh and Back keep the state (URL).
- Labels appear from zoom 14, don't block taps, and are readable on the imagery.
- Tapping a shape still works with the layer on: the new layer doesn't steal taps meant for others.
- Tooltips show names, and a name containing <b>x</b> shows as text, not bold.
- The legend matches the map colours exactly.
- Toggling the layer 20 times doesn't leave extra panes or layers behind (check document.querySelectorAll
  for the pane, and map.eachLayer counts).

How to verify (show me)
- Screenshots with the layer on at 390x844 and 1280x800, one zoomed out (no labels) and one zoomed in (labels).
- One screenshot at 320x568 with the Layers drawer (or switch list) open.
- The build output.
```
