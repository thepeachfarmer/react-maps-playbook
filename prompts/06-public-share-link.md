# 06 · A public share link with a token

**Use it when:** you want to text one map to someone with no account, at a link like `/s/<token>`.
**Fill in:** `<what the shared map shows>`, `<the GeoJSON file>` (or "make a sample one"), `<designs>` if it needs several versions (e.g. "Final, Plan 1, Plan 2").
**Read first:** `docs/playbook/05-share-links-and-internal-maps.md` (the viewer, tokens, designs), and `docs/playbook/06-data-pipeline.md` (the GeoJSON contract).

```text
Goal
Add a public, login-free map viewer at /s/<token> that shows <what the shared map shows> from
<the GeoJSON file>. Support these designs on one link: <designs>.
Read docs/playbook/05-share-links-and-internal-maps.md and the GeoJSON contract in
docs/playbook/06-data-pipeline.md first.

What to build
- client/share.html as a second Vite entry (build.rollupOptions.input = {main, share}). Plain TypeScript +
  Leaflet. No React, no service worker, no manifest, and <meta name="robots" content="noindex">.
- A small Vite dev plugin that rewrites /s/<x>?... to /share.html?t=<x>&... so dev links match production.
  In production, Express sends share.html for /s/:token with X-Robots-Tag: noindex, nofollow.
- Viewer boot:
  1. Draw the top bar first (the app icon, not a link for public visitors, and the title once it's known).
  2. Fetch /api/share/<token>?design=<id>.
  3. Map errors to words: 404 "This link is not valid or has expired", network failure "No connection. Check
     your signal." with a Try again button, other errors "Something went wrong".
  4. Render by fc.kind. The default renderer styles each feature from its properties (layer, stroke,
     stroke_width, dash, fill, fill_opacity, group, label, name, note). Run every string through esc().
  5. Use L.canvas({tolerance:10}) as the renderer. Fit once with padding that clears the bar.
  6. A legend as <details>, open by default only at >=700px. A "Show" group of checkboxes from fc.groups.
  7. A "My location" button (watchPosition, follow until the user drags, PERMISSION_DENIED message, keep the
     last fix on weak signal). The GPS dot goes in its own pane with pointer-events:none.
- Designs: draw a segmented control only when there are 2+ designs. Switching uses location.replace() and
  deletes ?design for the default one, so Back goes to the previous page, not through every design.
- Server: server/src/shares.ts with a SHARES registry keyed by token, using a PLACEHOLDER token in the repo.
  Make real tokens with: python3 -c "import secrets,string; a=string.digits+string.ascii_lowercase;
  print('<slug>-' + ''.join(secrets.choice(a) for _ in range(10)))"
  - GET /api/share/:token: Object.hasOwn lookup, 404 if missing, design chosen by id or alias (falling back to
    the first), Cache-Control: no-cache, X-Robots-Tag: noindex, nofollow. It reads static files from
    data/shares/ only, never the database.
  - GET /api/share/:token/asset/:name: serves only names listed in that share's assets map.
- A README section: how to add a share, update it (rebuild the file and redeploy), and revoke it (delete the
  entry and redeploy).

Constraints
- The public routes never read the database and never take a file path from the client.
- No real tokens in the repo, in tests, or in screenshots (use the placeholder).
- The share page must work on a slow connection: keep it small, with no React.

Acceptance checks
- /s/<placeholder-token> shows the map in a private window (signed out).
- /s/does-not-exist and /s/constructor both show "This link is not valid or has expired" (404).
- curl --path-as-is "/api/share/<token>/asset/..%2F..%2Fpackage.json" returns 404, and so does any asset
  name that isn't in the share's assets map.
- Switching designs updates the URL, and Back afterwards leaves the page instead of stepping through designs.
- The page's built JS bundle has no React in it (check the size and the imports).
- Turning off the network and reloading shows the friendly message with Try again.

How to verify (show me)
- Screenshots of the share page at 320x568, 390x844, 844x390 and 1280x800, in a signed-out browser.
- One screenshot with each design selected, and one of the 404 message.
- curl -I output for /s/<token> showing the X-Robots-Tag header.
```
