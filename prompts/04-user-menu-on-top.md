# 04 · A user menu that stays on top

**Use it when:** you want the top-right avatar menu, and you never want to see it open behind the map again.
**Fill in:** nothing, unless you want different menu items. If auth isn't set up yet, use a fake user from `/api/auth/me` that returns a placeholder in development only.
**Read first:** `docs/playbook/03-menus-on-top.md` (all of it), and `docs/playbook/08-deploy.md` section 9 (hardReset).

```text
Goal
Add a user menu to the right end of the top bar: an avatar pill (initials, plus the name and a role chip
from the sm breakpoint up) that opens a dropdown with:
  identity card (name, email, role badge) / Send feedback / About / Clear cache & reload / Log out (red).
It must ALWAYS open above everything: the map, popups, drawers and modals.
Read docs/playbook/03-menus-on-top.md first. The portal pattern there is non-negotiable.

What to build
- client/src/components/UserMenu.tsx:
  - The dropdown is rendered with createPortal(..., document.body). A fixed inset-0 z-[9998] transparent
    backdrop closes it on click. The menu itself is fixed z-[9999], w-72 max-w-[calc(100vw-1rem)].
  - Position it from the trigger's getBoundingClientRect() (top = bottom + 8, right = innerWidth - right),
    recomputed on resize and on scroll (capture phase). Escape closes it.
  - Items are buttons with role="menuitem", min-h-11, touch-manipulation.
  - Initials: the first letters of the first two words of the name; "U" if there's no name.
- client/src/lib/hardReset.ts: unregister service workers, delete all Cache Storage and IndexedDB, clear
  local and session storage (keep cookies), wait 100ms, then location.replace() with ?_hardReset=<timestamp>.
- An About dialog (portaled, modal tier z-[2000]) that shows name, version, commit_sha, built_at and
  started_at from GET /api/about.
- A feedback modal: a bottom sheet on phones (items-end sm:items-center), centred on desktop. Title (required),
  a category chip, details. The page URL is captured automatically. POST /api/feedback stores it (any
  signed-in user can submit). Admin-only routes: GET list, GET export (Content-Disposition attachment,
  Cache-Control no-store), PUT status, DELETE. The table is created by an idempotent migration.
- Log out calls the auth module's logout (or a stub that says "auth not set up yet").
- Update the z-index ladder comment.

Constraints
- Do NOT render the dropdown inside the header, even "just for now". No absolute-positioned local dropdown.
- Do NOT close it with a document pointerdown listener. Use the backdrop.
- Don't change the header's own z-index or styles to make this work.

Acceptance checks
- The menu opens on top of: the bare map, an open Leaflet popup, the left drawer, the right drawer, and the
  About dialog's trigger area.
- Tapping outside closes it, and that tap does NOT also select a field or marker underneath.
- Escape closes it. Tab moves through the items.
- At 320px, the menu fits on screen and every item is at least 44px tall.
- Clear cache & reload reloads with a ?_hardReset= query and the user is still signed in afterwards.
- About shows the version from /api/about.

How to verify (show me)
- Screenshots at 320x568 and 1280x800 with the menu open over the map, and one at 390x844 with the menu
  open while the right drawer is also open.
- A screenshot of the About dialog.
- The build output.
```
