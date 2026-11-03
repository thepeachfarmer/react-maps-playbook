# 01 · Start a new map app

**Use it when:** you have an empty repo and want the skeleton every later prompt builds on.
**Fill in:** `<app-name>`, `<what the map is for>`, `<start-lat>, <start-lng>` (any spot you like; you can change it later).
**Read first:** `docs/playbook/01-architecture.md`, `docs/playbook/02-the-map-page.md` sections 1–4, and section 1 of `docs/playbook/08-deploy.md` (the Dockerfile).
**Before you start:** keep a checkout of the playbook next to this repo (or copy its `docs/` in as `docs/playbook/`). Step 5 copies two of its script folders.

```text
Goal
Create a new map web app called <app-name> in this repo. It's for <what the map is for>.
Follow docs/playbook/01-architecture.md ("shape A": one image, Express serves the API and the built React app)
and docs/playbook/02-the-map-page.md sections 1-4. Read both before writing code, then show me your file plan.

What to build
1. client/ : React + Vite + TypeScript + Tailwind, react-leaflet + Leaflet 1.9.
   - A tiny router in client/src/lib/nav.ts (navigate, goHome, useLocation via useSyncExternalStore),
     no router library. Two places: "/" (Home) and "/map".
   - Home: a grid of tiles from GET /api/maps (start with one tile, "Fields", linking to /map?layers=fields).
     Home is a fixed full-screen layer at z-[1500].
   - The map stays mounted after the first visit: render it with inert + aria-hidden while Home is showing,
     so going Home and back keeps the position and zoom.
   - The map page: full-bleed MapContainer (zoomControl off), Esri World Imagery tiles with maxNativeZoom 19,
     maxZoom 21, keepBuffer 4, a transparent errorTileUrl, attribution kept. Start centre <start-lat>, <start-lng>
     in client/src/config.ts.
   - A two-line top bar (absolute, z-[1000], bg-gray-900/90 backdrop-blur): app icon as a Home button with
     aria-label, an h1 title that truncates, and an empty slot on the right for the user menu. Line 2 holds a
     "Layers" button (no drawer yet). Safe-area padding on top, left and right; buttons min 44px.
   - Layers live in the URL (?layers=a,b), read during render and written back with history.replaceState.
   - A class error boundary showing "Something went wrong / Reload" at z-[2000].
   - client/src/lib/esc.ts (HTML escaper) and a z-index ladder comment at the top of client/src/index.css,
     copied from docs/playbook/03-menus-on-top.md.
2. server/ : Express 5 (install express@5) + TypeScript, raw SQL via pg, no ORM.
   - Numbered SQL migrations in server/src/db/migrations applied on boot and recorded in a migrations table.
   - 001-init.sql creates a fields table (id, name, crop, season, boundary geometry(Polygon, 4326)).
   - Seed 3 made-up rectangular fields near the start centre. Invented names only ("North 40", "Creek",
     "Home Block"). No real data.
   - GET /api/fields returns a GeoJSON FeatureCollection using ST_AsGeoJSON(boundary)::json.
   - GET /api/maps returns the tile list from a MAPS array in server code.
   - GET /health: always HTTP 200, body {status, version, commit_sha, built_at, started_at, checks:{db}}
     with a SELECT 1 check. GET /api/about: name, version, commit_sha, built_at, started_at.
   - Mount order: /api/about, /health, then the data routes. A final JSON error handler.
     process.on('unhandledRejection') logs.
   - In production, serve client/dist with an SPA fallback to index.html, written for Express 5:
     app.get('/{*splat}', ...). The Express 4 form app.get('*', ...) crashes Express 5 at startup.
3. The fields layer on the map: outline + light fill, a sticky tooltip with the (escaped) name, and FitOnce
   to the data on first load (animate:false).
4. Dev setup: docker-compose.dev.yml with postgis/postgis:16-3.4 and redis:7-alpine bound to 127.0.0.1;
   a root package.json "dev" script that runs server and client together with concurrently; the Vite proxy
   sends /api to http://localhost:3000.
5. Repo hygiene and the house-rules tools:
   - .gitignore: node_modules/, dist/, .venv/, .env, .env.*, *.env, !.env.example, !*.env.example,
     /secrets/ (anchored, so scripts/secrets/ stays committable), *.pem, *.key, inbox/*, !inbox/.gitkeep,
     outbox/*, !outbox/.gitkeep, screenshots/. Screenshots of the real app go to outbox/, so it must be
     ignored.
   - .env.example with every variable name and empty values; inbox/.gitkeep and outbox/.gitkeep.
   - Copy the playbook's scripts/lib/ and scripts/secrets/ folders into scripts/ unchanged: the key loader
     (load-env.sh --check) and the pre-push scanner (scan-before-push.sh) that the house rules use.
   - A first Dockerfile for shape A, multi-stage as in docs/playbook/08-deploy.md section 1: node:22-alpine
     client-build and server-build stages, then a runtime stage that runs node server/dist/index.js with
     NODE_ENV=production. No inline comments after instructions. Prompt 10 adds the build arguments, CI and
     the production compose file later. This image isn't for deploying yet: sign-in and the fail-closed
     check come in prompt 16 (or 11).
   - .dockerignore: node_modules, dist, .git, .env, .env.*, *.env, secrets, *.pem, *.key, *.log, inbox,
     outbox.
   - A README with "how to run it locally".

Constraints
- No secrets, real hostnames, IPs or real data anywhere. Placeholders only.
- No router library, no ORM, no CSS framework other than Tailwind.
- Don't add auth yet (that's a later prompt). Don't add a service worker yet.
- Keep components small: MapPage, HomePage, TopBar, FieldsLayer, FitOnce, Crash.

Acceptance checks
- npm run build passes in client and server, with no TypeScript errors.
- docker build -t <app-name>:local . passes, and docker run --rm <app-name>:local ls -la /app shows no .env,
  secrets/, inbox/, outbox/ or .git.
- scripts/secrets/scan-before-push.sh reports "Clean", and git check-ignore -q outbox/x.png succeeds while
  git check-ignore -q scripts/secrets/scan-before-push.sh fails (the scanner stays committable).
- With the dev database up and npm run dev, Home shows a "Fields" tile, and clicking it opens /map with the
  3 fake fields on satellite imagery.
- Pan and zoom, go Home with the icon, open the tile again: the map is exactly where you left it.
- The Back button from /map returns to Home without replaying history; refreshing /map?layers=fields keeps
  the layer on.
- curl localhost:3000/health returns 200 with status "ok" and checks.db.status "ok".
- No horizontal scroll at 320px. The title truncates instead of wrapping.

How to verify (show me)
- Screenshots of Home and /map at 320x568, 390x844, 844x390 and 1280x800 in outbox/ (use Playwright's
  viewport, see docs/playbook/09-mobile-first.md section 8).
- The output of the two builds, the docker build and of curl /health.
- The scan's summary line.
- git status showing no .env, inbox or outbox files staged.
```
