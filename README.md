# React Maps Playbook

A practical guide to building map web apps with React and Leaflet. We wrote it from about a dozen map apps we built and run for a working farm. It covers how the pieces fit together, why each one is built the way it is, where to run the result, the bugs we hit and how we fixed them, and copy-paste prompts so an AI coding agent can build the same things for you.

There's nothing to install. The repo is documents (`docs/`), prompts (`prompts/`), a small demo app with invented data (`example/`), key-safe helper scripts (`scripts/`) and copy-paste server setups for HTTPS and login (`infra/`).

**New here? Start with the illustrated guide,** [`docs/how-our-maps-work.pdf`](docs/how-our-maps-work.pdf). Its 20 pages walk through the whole thing in plain language, with diagrams and screenshots of the demo. Its source is [`docs/guide/index.html`](docs/guide/index.html).

## Where these patterns came from

We use maps for a lot of different jobs, and the same handful of ideas kept coming back:

- **A field-operations map.** Every field is a shape on satellite imagery, coloured by what was planted, sprayed or harvested, with live equipment positions on top.
- **An irrigation pump dashboard.** Fields are coloured by days since they were last watered, and pressure sensors show as dots fed live over a WebSocket.
- **Fleet maps** for sprayers, tractors and pickups: status dots, the day's track coloured by activity, a replay slider.
- **A weather-station and rain-gauge map** with value badges on a colour scale and a radar overlay.
- **A multi-tenant portal**, where each customer sees only their own field boundaries.
- **Public share links.** Someone outside the company opens one map on a phone without an account.
- **A public visitor app** with a "you are here" dot that works offline, plus a TV kiosk version of the same map.

## The stack at a glance

| Part | What we use | Why, in one line |
|---|---|---|
| UI | React + Vite + TypeScript + Tailwind CSS | Fast dev server, typed code, styling without separate CSS files |
| Map | Leaflet 1.9 through react-leaflet | Small, stable, good on phones, lots of plugins |
| Basemap | Esri World Imagery satellite tiles | Free, no API key, and on a farm the aerial view matters more than streets |
| Share viewer | Plain TypeScript + Leaflet, no React | A tiny page that loads fast on a weak phone signal |
| API | Express + TypeScript (Node) or FastAPI (Python) | Plain HTTP and JSON, raw SQL, no ORM |
| Database | PostgreSQL with PostGIS or TimescaleDB, plus Redis | Shapes, sensor time-series, short-lived login state |
| Map data | Small Python tools that write static GeoJSON files | Repeatable, reviewable in git, no database query at runtime |
| Sign-in | OIDC with Authentik, optional per app | One login for every app, roles from groups, and production refuses to start without it (docs/14) |
| Shipping | Docker, GitHub Actions, GHCR, Portainer | Merge to main and the server pulls the new image |
| Hosting | Your own server, or a DigitalOcean droplet | Internal apps at the office, public maps somewhere a power cut can't reach (docs/11) |
| Edge | Caddy (HTTPS) behind Cloudflare (DNS + CDN) | Automatic certificates, one wildcard certificate and one place for routing (docs/13) |
| Keys | Gitignored `secrets/*.env` or the macOS Keychain, read by single-purpose scripts | The agent runs a script and never sees the key (docs/12) |

### How the demo differs from the house stack

`example/` is small on purpose, so a few things in it are simpler than the stack above. **Copy its patterns, not these shortcuts:**

| The house stack (docs and prompts) | The demo in `example/` | Why it differs |
|---|---|---|
| Tailwind CSS | Plain CSS in `src/styles.css` | So you can read every rule in one file |
| Esri World Imagery (satellite) | OpenStreetMap tiles | Only the tile URL differs (`VITE_TILE_URL`) |
| Share viewer: a separate `share.html`, plain TypeScript + Leaflet, **no React** | A React route inside the main bundle (`src/share/ShareViewer.tsx`) | One build for a demo. **Don't copy this part:** a real share page stays React-free (docs/05, prompt 06) |
| Share tokens looked up on the server | A public `public/shares/registry.json` | There's no API. A public registry lists every token, so a real app keeps it on the server |
| Data from the API and PostGIS | Invented data in `src/data/demoFarm.ts` | No database to set up |
| Layers and list + detail in slide-out drawers | A Layers drawer plus a *list sheet* (a bottom sheet on a phone, a side panel when wider) | The demo is one list-first map mode. Drawers stay drawers at every size (docs/02 sections 7 and 10) |
| Express + TypeScript server | Optional `server/` in plain JavaScript, checked by TypeScript | Three small files you can read in one sitting |

When you tell an agent "copy it from `example/`", add: "but follow the house rules: Tailwind, the satellite basemap, and a React-free `share.html`."

## What's in this repo

```
react-maps-playbook/
├── README.md                          you are here
├── LICENSE                            MIT: copy and adapt freely
├── docs/
│   ├── how-our-maps-work.pdf          the illustrated guide: start here
│   ├── guide/index.html               its source (HTML, printed to PDF with headless Chrome)
│   ├── 01-architecture.md             how the pieces fit: client, server, data, app shell, Home catalog
│   ├── 02-the-map-page.md             layers, drawers, legends, popups, labels, lists, totals, My location
│   ├── 03-menus-on-top.md             why menus hide behind the map, and the portal fix
│   ├── 04-icons.md                    map markers, equipment clip art, tile icons, app icons
│   ├── 05-share-links-and-internal-maps.md   public /s/<token> links and signed-in /m/<id> maps
│   ├── 06-data-pipeline.md            downloaded files → GeoJSON, read safely, rebuilt byte-identically
│   ├── 07-auth.md                     OIDC sign-in in depth: tokens, roles, refresh, logout, failing closed
│   ├── 08-deploy.md                   Docker, GitHub Actions → GHCR, Portainer, Caddy/Cloudflare, caches
│   ├── 09-mobile-first.md             320 / 390 / landscape, safe areas, touch, testing at phone sizes
│   ├── 10-lessons-learned.md          things that broke, and the fixes
│   ├── 11-where-to-run-it.md          your laptop, your own server, or a DigitalOcean droplet
│   ├── 12-keys-and-scripts.md         keeping keys out of chats, commits and logs; scripts, not keys
│   ├── 13-https-with-caddy.md         one front door: certificates, Cloudflare in front, common mistakes
│   ├── 14-login-with-authentik.md     running Authentik, connecting an app, logout, passkeys, fail closed
│   └── img/                           screenshots of the demo app (invented data, on a synthetic basemap)
├── prompts/
│   ├── README.md                      how to use the prompts, plus "house rules" for your agent
│   └── 01-…16-*.md                    one copy-paste prompt per capability
├── example/                           a small runnable demo map (all data invented), with an optional
│                                      sign-in server in example/server/ (off by default)
├── scripts/                           key-safe helpers: DigitalOcean, Portainer redeploy, CI wait,
│                                      a scan-before-push secrets check (see scripts/README.md)
└── infra/
    ├── caddy/                         the HTTPS front door: Caddyfile.example, docker-compose.yml, .env.example
    └── authentik/                     the identity provider: docker-compose.yml, .env.example, checklists
```

## How to use it with an AI agent

1. Read the guide ([`docs/how-our-maps-work.pdf`](docs/how-our-maps-work.pdf)), or skim [`docs/01-architecture.md`](docs/01-architecture.md) to get the overall shape.
2. Open [`prompts/README.md`](prompts/README.md) and copy the **house rules** block into your agent's instructions file (`CLAUDE.md`, `AGENTS.md`, or whatever your tool reads). Then every session starts with them.
3. Start a fresh repo and run `prompts/01-start-a-new-map-app.md`.
4. Add one capability at a time with the other prompts: one prompt per branch, one branch per session.
5. Every prompt ends with acceptance checks and a "How to verify" list. Don't accept "done" until the agent shows you screenshots at phone sizes and a passing Docker build.
6. Finish each big feature with `prompts/12-review-and-verify.md`.

Tell the agent which doc to read first, for example: "Read docs/03-menus-on-top.md before you start." The docs explain why, and the prompts say what to do. An agent does much better work when it has both.

## Where to run it

The same Docker image runs in three places. [`docs/11-where-to-run-it.md`](docs/11-where-to-run-it.md) compares them and walks through each one.

- **Your laptop** for building and testing: `npm run dev`, then the real image with `docker compose up --build`.
- **Your own server** for internal staff apps: Docker + Portainer, behind Caddy and your login.
- **A DigitalOcean droplet** for anything outsiders must reach, such as public share links and customer maps. `scripts/do/provision-droplet.sh` creates the droplet, firewall, reserved IP and DNS record, and shows you the plan and the cost before it spends anything. Prompt 13 has the agent do it with you.

## Keys and scripts

When you build with an AI agent, a key can escape through the chat, the transcript, a settings file, a log or a commit. [`docs/12-keys-and-scripts.md`](docs/12-keys-and-scripts.md) has the rules, and [`scripts/`](scripts/README.md) has the tools.

- **A key you pasted into a chat is leaked.** Revoke it and make a new one.
- **Keys live in `secrets/*.env` (gitignored, `chmod 600`) or the macOS Keychain.** Never on a command line, in a URL, in a settings file or in a commit.
- **Give the agent scripts, not keys.** A script reads the key at run time, does one job, and prints only safe results. Every script has `--help`, and every script that changes something has a `--dry-run` that needs no key. (Read-only ones, such as `check-health.sh` and `load-env.sh --check`, don't need one.)
- **Scan before you push** with `scripts/secrets/scan-before-push.sh`. Prompt 14 wraps your own jobs in scripts like these.

## HTTPS

One Caddy container is the front door for every app. It gets and renews certificates by itself and forwards each hostname to the right app. [`docs/13-https-with-caddy.md`](docs/13-https-with-caddy.md) covers one app start to finish, many apps, Cloudflare in front (always **Full (strict)**, never Flexible), a wildcard certificate through DNS-01, and a table of the mistakes that cost us time. The copy-paste files are in [`infra/caddy/`](infra/caddy/README.md), and prompt 15 is the agent's version.

## Optional login

Public demos, kiosks and share links need no login. Maps with real data do. [`docs/14-login-with-authentik.md`](docs/14-login-with-authentik.md) covers running Authentik ([`infra/authentik/`](infra/authentik/README.md)), connecting an app, the two ways to protect it, logout that really logs out, passkeys, and the rule that matters most: **in production, an app with missing login settings refuses to start.** The demo app's optional server ([`example/server/`](example/server/)) does exactly that, and its sign-in is off by default. [`docs/07-auth.md`](docs/07-auth.md) goes deeper on the app side. Prompt 16 (or prompt 11 for tokens in memory) is the agent's version.

## What not to put in a public repo

Everything here uses placeholders on purpose: `example.com` (and names under it, such as `maps.example.com`), `203.0.113.10`, `<token>`, `ghcr.io/<owner>/<app>`, "the fields API". `example.com` is reserved for documentation (RFC 2606) and `203.0.113.0/24` is a documentation address range, so a command you copy without editing can't reach somebody else's server. **Replace them with your own domain and addresses before you run anything.** Do the same in your own repos.

- **No secrets.** That means API keys, passwords, OIDC client secrets, JWT secrets, `.env` files, private keys and service-account JSON. Commit a `.env.example` with the names and empty values.
- **No real share tokens.** On a public link, the token is the only lock.
- **No real hostnames,** internal IP addresses, the ports behind them, or admin URLs.
- **No real data,** in code, sample files or screenshots. That covers field boundaries, coordinates, customer and staff names, yields and prices.
- **No data baked into a public Docker image.** Anyone who can pull the image can read every file in it.
- **Check the history, not just today's files.** Before making a repo public, scan its whole history: `scripts/secrets/scan-before-push.sh --history`, plus a dedicated tool such as gitleaks or trufflehog. The easier route is to start a fresh public repo and copy in only what you mean to share, rather than flipping a private repo to public.

## License

MIT. See [`LICENSE`](LICENSE). Copy the docs, prompts, scripts and demo into your own projects and change them as you like.

## Words you'll see

- **SPA (single-page app):** one HTML page whose JavaScript draws every screen.
- **Leaflet:** the JavaScript library that draws the map. **react-leaflet** lets you use it as React components.
- **Tiles / basemap:** the background imagery, loaded as small square pictures.
- **GeoJSON:** a JSON format for shapes (points, lines, polygons), each with a bag of properties.
- **Layer:** one set of things on the map (fields, equipment, labels) that you can turn on or off.
- **Pane:** a Leaflet container that decides what draws above what.
- **z-index:** the CSS number that decides what's on top. **Stacking context:** a box whose children can only be ordered against each other (see docs/03).
- **Portal (`createPortal`):** React drawing a component somewhere else in the page, usually straight into `<body>`.
- **PWA (progressive web app):** a website you can install to a phone's home screen. **Service worker:** the background script that caches it.
- **OIDC:** the standard behind "Sign in with…" buttons. **IdP (identity provider):** the server that owns the logins. **Authentik** is the one we run.
- **JWT:** a signed token that says who you are, which the server can check without a database lookup.
- **Docker image:** a packaged app. **GHCR:** GitHub's container registry, where images are stored. **Portainer:** a web UI that runs Docker stacks. **Caddy:** a web server that handles HTTPS and forwards each request to the right app (a reverse proxy).
- **Droplet:** DigitalOcean's name for a rented virtual server. **cloud-init:** the setup file a new server runs on its first boot.
- **PostGIS:** a PostgreSQL add-on that understands shapes, areas and distances.
