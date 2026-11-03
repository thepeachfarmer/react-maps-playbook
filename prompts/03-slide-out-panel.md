# 03 · Slide-out panels (drawers)

**Use it when:** you want the map to stay full screen, with a left "Map layers" drawer and a right list + detail drawer that slide over it.
**Fill in:** `<what the list shows>` (fields, machines, gauges…), `<how to group it>`, `<detail fields>`.
**Read first:** `docs/playbook/02-the-map-page.md` sections 6, 7, 8 and 10, and `docs/playbook/03-menus-on-top.md` (the z-index ladder).

```text
Goal
Add two slide-out drawers to the map page:
- Left: "Map layers" (the layer switches, overlay modes, and the legend for the active mode).
- Right: a list of <what the list shows>, grouped by <how to group it>, with a search box, and a detail
  view for the selected item showing <detail fields>.
Tapping a shape on the map opens the right drawer to that item's detail.
Read docs/playbook/02-the-map-page.md sections 6-8 and 10 and docs/playbook/03-menus-on-top.md first.

What to build
- A Drawer component used by both sides: two fixed elements that are always in the DOM.
  - Backdrop: fixed inset-0 z-[1390] bg-black/40, opacity transition, pointer-events-none when closed,
    click closes.
  - Panel: fixed inset-y-0 left-0 (or right-0) z-[1400], w-80 max-w-[85vw] (right: w-96 max-w-[90vw]),
    slides with translate-x over 200ms, role="dialog" with aria-label, a header with a 44px close button,
    and a scrollable body (flex-1 overflow-y-auto overscroll-contain).
  - Escape closes it. Safe-area padding on the top and the outer side.
- One rule for drawers: they slide out over the map at EVERY screen size. No inline desktop sidebar, and
  no bottom-sheet version of a drawer on phones. (A "list sheet", which is a bottom sheet on a phone and a
  side panel on wider screens, is a different component for the light viewer or a list-first map mode,
  docs/playbook/02-the-map-page.md section 10. The playbook's example/ uses one for its Fields list. Don't
  turn these drawers into one.)
- The "Layers" button in the top bar opens the left drawer, and a "<List name>" button opens the right one.
- Right drawer: a search box (normalised, every word must match), groups sorted by <how to sort>, rows that
  are buttons (or tabIndex=0 with Enter/Space). Tapping a row selects the item, flies to it, and on a phone
  closes the drawer first.
- Selection: clear the selected item about 300ms AFTER the drawer closes, so it slides out with its content.
- When the right drawer is open and you fit to an item, use lopsided padding so the item lands in the
  visible part of the map: paddingTopLeft [40, bar height], paddingBottomRight [drawer width on desktop, 40].
- Leaving the map (going Home) closes both drawers, so the next visit opens clean.
- Update the z-index ladder comment if anything new was added.

Constraints
- Drawers must be above Leaflet's controls (1000). Don't put them inside MapContainer.
- Don't move or restyle the top bar.
- Keyboard: focus goes into the drawer when it opens and back to the button when it closes.

Acceptance checks
- Both drawers open and close with their button, the backdrop, the X, and Escape.
- With a drawer open, Leaflet's zoom and attribution controls don't show through it.
- Tapping a field opens the right drawer to its detail. Tapping a row zooms to the item, and the item
  isn't hidden under the drawer.
- At 844x390 (landscape phone), an open drawer still leaves the map usable.
- Go Home and come back: the drawers are closed and the map hasn't moved.

How to verify (show me)
- Screenshots at 320x568 and 390x844 with each drawer open, at 844x390 with the right drawer open, and at
  1280x800 with the right drawer showing a selected item.
- The build output.
```
