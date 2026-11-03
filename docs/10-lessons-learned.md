# 10 · Lessons learned

Almost every item here broke in one of our apps, and the rest were near misses. Each one says what happened and how we fixed it. The fixes are explained in more detail in the other docs.

## If you remember nothing else

1. **Portal every menu and dropdown into `document.body`** at z 9998/9999. Raising the z-index alone never sticks (docs/03).
2. **Write the z-index ladder down,** starting from Leaflet's own numbers (200–700, controls 1000).
3. **Fail closed.** Production refuses to start without its auth config, and secrets in compose use `${VAR:?}` (docs/07, docs/14).
4. **A scripted redeploy must send the environment back,** or it wipes every secret (docs/08). `scripts/portainer/redeploy.py` does.
5. **Never precache `index.html` in an online app, and never cache `/api/*`** in a service worker (docs/08).
6. **Call `invalidateSize()` whenever the map's box might have changed.** Leaflet measures once (docs/09).
7. **Escape every string that goes into Leaflet HTML** (divIcons, string tooltips and popups) (docs/04).
8. **Check 320, 390, 844×390 and 1280,** with a real viewport, not `--window-size` (docs/09).
9. **Build the Docker image locally and open the app in a browser** before you call anything done.
10. **No real tokens, hostnames or data in a public repo,** including its history. Give the agent scripts, not keys, and scan before you push (docs/12).

## Menus, panels and layering

1. **The user menu opened behind the map,** in three different apps. Its `absolute z-50` dropdown sat under Leaflet, whose controls are at 1000. → Portal to `body`, with backdrop 9998 and menu 9999.
2. **"Fixed" by removing the header's z-index and bumping the dropdown to 2500.** It worked locally and broke in production the same day, because another ancestor created a stacking context. → Portal.
3. **A `document` `pointerdown` "click outside" listener** closed the menu, and the same click fell through to a marker underneath. → A transparent click-trap backdrop element.
4. **The mobile sidebar rendered under the map.** It was at z 900, which clears Leaflet's panes but not its controls. → Drawers at 1100–1900, and the ladder written down.
5. **Modals rendered under the sidebar.** In another app, the About dialog (2000) rendered behind its own user menu (2500). → Check the ladder, don't copy numbers from another app.
6. **An embedded map covered the page's menu drawer on phones,** where the customer and season switchers lived. → `relative isolate z-0` on the map box.
7. **A slider in a modal inside the map panned the map** on phones. Touch events bubbled to Leaflet's drag handler. → Portal the modal, or stop touch propagation on its root.
8. **A click inside a portaled dialog collapsed the table row that opened it.** React portal events bubble through React parents. A map drag released over the backdrop also closed the dialog. → Stop propagation at the dialog's edge, and close only when both the press and the release were on the backdrop.
9. **An inline desktop sidebar made the hamburger button do nothing on desktop.** → One drawer behaviour at every size: drawers always slide out. (A list sheet that docks beside the map on wide screens is a different component, docs/02 section 10.)

## Layout and mobile

10. **On an iPhone home-screen app, the map rendered at a stale size,** with white space underneath and tiles off the grid. → `InvalidateOnResize` (a ResizeObserver, `visualViewport` and `orientationchange`) plus `100dvh`.
11. **`height: 100%` on `html` and `body`** showed only the top quarter of the screen in iOS Safari and the PWA. → `100dvh` with fallbacks.
12. **A Tailwind `calc()` with spaces silently did nothing.** The first space ends the class name. → Write `calc(a+b)` with no spaces.
13. **The multi-line map attribution covered the My Location button** on phones. → Truncate it to one line at 9 px under 768 px.
14. **A full-screen dialog's close button sat under the status bar.** → Pad the header with `env(safe-area-inset-top)`.
15. **Landscape phones clipped the side buttons under the notch.** → Safe-area padding on the left and right edges too, at every width.
16. **`maximum-scale=1, user-scalable=no` in the viewport tag blocked every zoom gesture.** → Removed.
17. **A double-tap to zoom opened a form instead.** → A 300 ms tap debounce, and `touch-action: none` on the Leaflet container.
18. **A map inside a dialog showed one tile in a corner.** It mounted at 0 px while the dialog animated in. → `invalidateSize()` about 60 ms after mount.
19. **A mistyped prop silently removed a sheet's exit buttons,** and people were stuck. → One shared `BottomSheet` with three exits: ✕, the backdrop, and Escape.
20. **Headless Chrome screenshots looked fine at "320 px" but weren't.** `--window-size` lays pages out wider than you asked. → Playwright's viewport setting, or fixed-size iframes.

## Map behaviour

21. **Returning `<HomePage/>` instead of the map tree** unmounted Leaflet and reset the map on every trip Home. → Keep the map mounted with `inert`, and draw Home over it.
22. **Fitting to every vehicle** zoomed the fleet map out to state level when one truck left the area. → A fixed home view, or a user-drawn home area.
23. **A hard-coded default centre** opened every tenant's map on the first tenant's farm. → A fallback chain: the tenant's own features, then their address, then their postcode, then the region.
24. **A `FitBounds` that re-ran on every poll** yanked the map back whenever someone panned. → Fit once, and refit on a nonce or when the entity changes.
25. **The previous asset's track flashed** and the map refitted to it. → Key fetched data by `id|day`, and render only when the key matches.
26. **Gray "no data" tiles above zoom 19.** → `maxNativeZoom={19} maxZoom={21}`.
27. **Calling `createPane()` twice** orphaned a DOM node every time a layer was toggled. → `getPane() || createPane()`.
28. **A full-cover fog or trail pane swallowed every tap.** → `pointer-events: none`. The GPS dot also gets its own non-interactive pane.
29. **New data passed to `<GeoJSON data>` left the old shapes on screen.** It reads `data` once. → Change its `key`, or restyle in place with `setStyle`.
30. **Labels landed on the neighbouring field.** The corner-average "centroid" of an L-shaped field is outside it. → A point guaranteed to be inside, preferably precomputed.
31. **A missing coordinate became (0, 0)** and drew a confident dot in the ocean. → Filter `== null` and exact zeros before making markers.
32. **Shapes drew in the wrong place.** GeoJSON and KML are `[lng, lat]`, and Leaflet is `[lat, lng]`. → Swap on read, swap back on save.
33. **Group outlines showed phantom internal lines.** Shared edges didn't match exactly at the vertices. → Snap vertices within about 20 cm, split edges at T-junctions, then cancel the shared edges.
34. **Separate walks were joined by invented straight lines.** → Draw arrays of segments, and break tracks at time gaps.
35. **The draw tool's preview shape caught the next click.** → `interactive: false` on previews.
36. **leaflet-draw's TypeScript declarations wiped out Leaflet's types.** → `import 'leaflet'` before `declare module 'leaflet'`.
37. **Printing gave a blank page** (`display: none` can't target nested ancestors), integer zoom was too coarse for framing, and html2canvas shifted the markers. → Visibility rules in `@media print`, `zoomSnap={0.25}`, and rewriting pane transforms before capture.
38. **On the TV kiosk, dots vanished instead of fading.** The server and the screen encoded the fade policy separately. → One shared config, read by both.
39. **A machine reporting a generic "Tractor" category got the tractor icon** when it was really a sprayer. → A classifier with the most specific rule first, in one place for both the markers and the legend.

## Dates and time

40. **Evening entries were logged as tomorrow.** `toISOString().slice(0, 10)` is the UTC date. → Use local calendar days, and pin one farm time zone.
41. **Tracks shifted by the UTC offset,** and a live 15-minute window came up empty. The timestamps had no time zone and were parsed as UTC. → Store timestamps with a zone, and reject any that lack one.

## Live data

42. **A WebSocket froze after the phone was put away.** Timers were suspended, half-open sockets never fired `onclose`, and the UI trusted `isConnected`. → Resume events, a heartbeat, a staleness watchdog, and an `isLive` flag (docs/02).
43. **The WebSocket route "404'd" when tested with curl.** That was HTTP/2, which has no `Upgrade`. → `curl --http1.1`.

## Service workers and caches

44. **A white screen after a deploy.** The service worker served an old precached `index.html` that pointed at deleted bundles. → Never precache the shell in online apps. Add a boot watchdog in `index.html`, an error boundary, and "Clear cache & reload".
45. **Offline, the app served an older deploy's shell.** A NetworkFirst runtime cache on navigations outranked the precache. → `NetworkOnly` navigations with a precache fallback.
46. **Logout broke.** The service worker had cached the identity provider's 302 redirect. → Never runtime-cache `/api/*`.
47. **"Clear cache" did nothing.** `location.reload()` re-served the shell from the HTTP cache. → `location.replace(url + '?_hardReset=' + Date.now())`.
48. **The offline app's map data silently wasn't cached.** `.geojson` wasn't in `globPatterns`. → List every extension you need.
49. **An admin export came back missing the row just submitted.** The CDN had cached the GET. → `Cache-Control: no-store`.

## Build and deploy

50. **A scripted redeploy wiped the stack's environment.** Auth fell back to its dev default, and production served everything to everyone as admin. → Send `env` back on every API redeploy (`scripts/portainer/redeploy.py`), and fail closed in three layers (docs/07).
51. **`env_file: .env` produced empty values in Portainer.** → Explicit `environment:` entries with `${VAR}`.
52. **A new variable added to compose arrived empty.** Portainer doesn't detect new variables. → Add it in the UI in the same change, and recreate the stack.
53. **`${DB_PASSWORD:-app}` style defaults** meant a lost environment ran with a guessable secret. → `${VAR:?message}` for every secret.
54. **Deploying with `build:` failed with a confusing `http2: frame too large`.** The Portainer agent has no buildx. → `image:` from GHCR only, with a local override file for builds.
55. **A redeploy changed nothing.** "Re-pull image" was off, so the cached `:latest` was reused. → Turn it on, and compare `built_at` and `started_at`.
56. **A redeploy right after merging pulled the previous image,** because CI hadn't finished. → Wait for CI, or trigger the redeploy from CI.
57. **A local build passed, then CI failed on TypeScript errors.** Cached layers hid them. → `docker build --no-cache --target client-build .` as a pre-flight.
58. **`exec format error` on the server.** The image was hand-built on an ARM Mac. → `--platform linux/amd64`, or let CI build.
59. **A clean build that would have white-screened every phone.** Stray JSX above the imports compiled fine. → Open the app in a real browser before deploying.
60. **The image push failed with 403.** → `permissions: packages: write` in the workflow.
61. **The version was always `x.y.1`.** → `fetch-depth: 0` on checkout.
62. **A deploy failed with `no space left on device`.** → Prune images and build cache, rotate logs, and schedule a weekly prune.
63. **Silent sign-in redirect loops behind the proxy.** → `app.set('trust proxy', 1)`.

## Security

64. **Names went straight into `divIcon` HTML.** That was harmless until user-editable names appeared. → `esc()` on every interpolation.
65. **`SHARES[token]` matched `'constructor'`.** → `Object.hasOwn(SHARES, token)`.
66. **A public read-only mirror trusted a marker header.** Without stripping it on the authenticated path, anyone could add it and skip login. → The authenticated nginx clears that header on every request.
67. **A `?next=` parameter can become an open redirect.** → Accept only same-site paths (`/` but not `//`), or a strict pattern such as `^/m/[\w-]+`.
68. **Real data baked into the image** means the image is as private as the data. → Keep the package private, or mount the data at runtime.
69. **Repo roots held gitignored secret files.** They weren't committed, but they were one `git add -f` away. → Keep secrets outside the repo where you can, scan the history before going public, and prefer a fresh public repo.

## Working with AI agents

70. **"Done" without looking.** An agent's build passing isn't a working app. → Every prompt in `prompts/` ends with screenshots at four sizes and a Docker build.
71. **Letting an agent redeploy production by itself.** A scripted redeploy is how the environment got wiped (item 50). → A production deploy needs your explicit OK in that session, every time. Put that in the house rules.
72. **"Simpler" rewrites of solved problems.** Two apps lost the portal pattern this way. → Point the agent at the doc (docs/03) and say the pattern is non-negotiable.

## Hosting, HTTPS, login and keys

The full lists are in docs/11 section 4 (droplet traps), the docs/13 mistakes table and docs/14 section 8. These are the ones that cost us the most time.

73. **A rebuilt droplet had no cloud firewall,** while the check said the firewall existed. It was attached by droplet ID, and the new droplet had a new ID. → Attach the firewall to a tag, and check that the droplet is covered, not just that the firewall exists (docs/11).
74. **A reserved IP kept billing after its droplet was destroyed,** and the rebuild script bought a second one. → Reuse an unassigned IP in the region first; release it on teardown unless you're rebuilding (docs/11).
75. **A droplet can come up healthy and still be one nobody can log in to,** if it was created with an account key whose private half is on an old laptop. The only fix is to re-create it. → Check the key's fingerprint against your own keys before creating anything (docs/11).
76. **A `docker compose pull` over SSH died with the session,** and Caddy served a 502 over a good certificate. → Run long jobs detached with `nohup … &` and tail the log. A 502 means the proxy works and the app doesn't (docs/11).
77. **A working server looked unreachable from a Mac.** `timeout 5 nc -z …` always "failed", because macOS has no `timeout` command. → `curl --max-time`, `nc -z -G 5`, and prove a probe works against something known to be up (docs/11).
78. **`ERR_TOO_MANY_REDIRECTS` behind Cloudflare.** Its SSL mode was Flexible, so Cloudflare asked over HTTP and Caddy redirected to HTTPS, forever. → Full (strict), always (docs/13).
79. **The DNS-01 challenge timed out.** A local DNS server had cached "no such record". → `resolvers 1.1.1.1` in the Caddy `tls` block (docs/13).
80. **"Logout doesn't really log out."** Authentik's default provider invalidation flow has no logout step, so the Authentik session survived. → Send people to `default-invalidation-flow`, or set it as the provider's invalidation flow (docs/14).
81. **After moving an app from forward_auth to native OIDC, its `fetch` calls failed as CORS errors.** The outpost still intercepted the hostname. → Remove the app from the outpost too, not just from the Caddyfile (docs/14).
82. **Sign-in failed with `discovered metadata issuer does not match`.** The issuer was copied without its trailing slash. → Copy it exactly as Authentik shows it (docs/14).
83. **A key pasted into a chat "just this once" is a leaked key.** Chats and agent transcripts are kept. → Revoke it, then replace it. Wrap the job in a script that reads the key at run time (docs/12, prompt 14).
