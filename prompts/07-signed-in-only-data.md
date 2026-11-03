# 07 · Signed-in-only data (internal maps and private extras)

**Use it when:** staff need a special map in the light viewer at `/m/<id>`, or a public link should show the same map without the private layers.
**Needs:** prompt 06 (the viewer page) and sign-in, from prompt 11 or prompt 16, done first. This prompt is written for 11 (tokens in memory, so the viewer needs a view cookie). With 16, the session cookie already reaches `/m/`: tell the agent to use the session instead of the view cookie, and skip that part.
**Fill in:** `<map-id>`, `<what it shows>`, `<public file(s)>`, `<signed-in-only file(s)>`, `<who may see it>` (everyone signed in, or admins).
**Read first:** `docs/playbook/05-share-links-and-internal-maps.md` sections "Internal maps" and "Public link, private extras", and `docs/playbook/07-auth.md`.

```text
Goal
Add an internal map "<map-id>" that shows <what it shows> in the lightweight viewer at /m/<map-id>, for
<who may see it>. Signed-in viewers also see <signed-in-only file(s)>. A public share link to the same map
shows only <public file(s)>.
Read the "Internal maps" and "Public link, private extras" sections of
docs/playbook/05-share-links-and-internal-maps.md and docs/playbook/07-auth.md first.

What to build
- server/src/internalMaps.ts: an INTERNAL_MAPS registry. Each entry has title, visibility
  ('everyone' | 'admins'), designs [{id, title, label, file}], extras (appended to every design, public too)
  and signedIn (appended ONLY on the /m/ route). A design whose file doesn't exist yet isn't offered.
- One loader, loadInternalMap(id, {public}), used by both routes. With public:true it never appends the
  signedIn files. An appended file's meta travels as extra_meta[kind].
- The view cookie:
  - POST /api/maps/session (bearer auth) signs a JWT {sub, role, sid, type:'view'} and sets
    app_view=<jwt>; Path=/api/maps; Max-Age=28800; HttpOnly; SameSite=Strict; Secure (production).
    If the token has no sid, Max-Age is 900 (15 minutes).
  - DELETE /api/maps/session (no auth) clears it. The SPA calls it with fetch(..., {keepalive:true})
    whenever it starts up signed out.
  - A viewAuth middleware accepts a bearer token OR the cookie. A cookie token must have type 'view', and its
    sid must not be revoked.
- GET /api/maps/:id/data behind viewAuth: 404 for an unknown id (Object.hasOwn), 403 when visibility is
  'admins' and the user isn't an admin.
- Express sends share.html for /m/:id with X-Robots-Tag: noindex, nofollow. The Vite dev plugin rewrites
  /m/<x> to /share.html?m=<x>.
- In the SPA: before navigating to /m/<id>, call POST /api/maps/session, and set a sessionStorage "came from
  Home" flag so the viewer can show a way back.
- In the viewer: fetch with credentials:'same-origin'. On 401, location.replace('/?next=' + this path).
  On 403, show "This map is for admins only".
- After sign-in, the SPA accepts next only if it matches /^\/m\/[\w-]+(\?[^#]*)?$/, gets a cookie, then
  location.replace(next).
- The viewer turns on its extra UI (status marks, a wider popup) only when the signed-in data is present.
  The public rendering must stay byte-for-byte the same.
- A Home tile for the map, with visibility respected by GET /api/maps.

Constraints
- The signed-in files must never be reachable through /api/share/<token>, whatever the query string says.
- The cookie's Path is /api/maps only. The rest of the app never sees it.
- No tokens in URLs, logs or localStorage.

Acceptance checks
- Signed in: /m/<map-id> shows the public layers plus the signed-in-only layers.
- Signed out, in a private window: /m/<map-id> sends you to sign in, then brings you back to the same map.
- The public share of the same map shows NO signed-in-only data. Check the JSON response itself, not just the
  screen.
- After logout, /api/maps/<map-id>/data returns 401 within one request (the sid is revoked).
- ?next=//evil.example and ?next=/m/x#@evil both fall back to Home instead of redirecting.
- A viewer (non-admin) gets the 403 message on an admins-only map.

How to verify (show me)
- Screenshots of the same map signed in (/m/) and public (/s/) at 390x844, side by side.
- The response headers of POST /api/maps/session (Set-Cookie flags), with the token value redacted.
- curl output of the public JSON showing that the signed-in-only kinds are absent.
```
