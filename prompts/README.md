# Prompts for your AI coding agent

Each file here is one copy-paste prompt for one capability. They're written for an agent that can read files, run commands and edit code in your repo, such as Claude Code or a similar tool.

## How to use them

1. **Put the house rules (below) in your agent's instructions file** (`CLAUDE.md`, `AGENTS.md`, or whatever your tool reads at the start of a session). Then you don't have to repeat them.
2. **Copy this playbook's `docs/` folder into your repo** as `docs/playbook/`, or keep a checkout next to it. The prompts tell the agent which doc to read first. Prompts 13–16 also use the playbook's `scripts/` and `infra/` folders; the agent copies what it needs.
3. **Pick a prompt and fill in the `<angle-bracket>` parts.** Paste everything inside the box. The prompts write hostnames as `example.com` (reserved for documentation, so nothing real gets hit by accident). Where a step really has to reach your server, put your own domain in.
4. **One prompt per branch, one branch per session.** Small steps are easier for you to check and easier for the agent to get right.
5. **Don't accept "done" until the acceptance checks pass** and you've seen the screenshots yourself. The agent should save them in `outbox/`.
6. **Commit after each working step,** then run `12-review-and-verify.md` before merging anything big.

Every prompt has the same parts:

- **Goal:** what you want, in plain words.
- **Read first:** the doc sections that explain the pattern.
- **Constraints:** the non-negotiables, meaning the things we learned the hard way.
- **Acceptance checks:** how you both know it's finished.
- **How to verify:** what the agent must show you (screenshots, command output).

## The house rules

Paste this into your agent's instructions file once:

```text
House rules for this project

Stack
- Client: React + Vite + TypeScript + Tailwind. Map: Leaflet 1.9 via react-leaflet. No router library.
- Server: Express + TypeScript with raw SQL via pg (or FastAPI for Python services). PostgreSQL + PostGIS, Redis.
- Map data that changes by season is static GeoJSON built by Python tools in tools/<source>/ (run with python3 -I).
- Ships as a Docker image built by GitHub Actions, pushed to GHCR, run by Portainer (own server) or
  docker compose (a droplet), behind Caddy for HTTPS.
- The playbook's example/ is a simplified demo. Copy its patterns, but where it differs from these rules
  (plain CSS, OpenStreetMap tiles, a React share viewer), follow these rules: Tailwind, satellite tiles,
  and a share.html with no React.

Privacy and secrets
- Never put secrets, tokens, passwords, real hostnames, internal IPs or real data in code, docs, commit messages,
  test fixtures or screenshots. Use placeholders (example.com, 203.0.113.10, <token>, ghcr.io/<owner>/<app>)
  and env vars.
- Real values live only in a gitignored .env or secrets/*.env (local), the macOS Keychain, or the
  Portainer stack env (production). .gitignore uses /secrets/ (anchored, so scripts/secrets/ is kept),
  .env, .env.*, *.env, inbox/* and outbox/*. .dockerignore has secrets, .env, .env.* and *.env.
- Never print the contents of .env files or API responses that contain secrets.
- Files I drop for you are in inbox/ (gitignored). Put files you make for me (screenshots, reports, exports)
  in outbox/ named <purpose>-YYYY-MM-DD.<ext>.

Keys (see docs/playbook/12-keys-and-scripts.md)
- Never ask me to paste a key, token or password into the chat. If a task needs one, use (or write) a
  single-purpose script in scripts/ that reads it from secrets/*.env or the macOS Keychain at run time.
- Never read, cat, grep, print or open files in secrets/ or any *.env file (except *.env.example).
  To check that a key exists, run scripts/lib/load-env.sh --check, which prints names only.
- Never put a key on a command line, in a URL, in a settings or permissions file, or in a commit.
- Never use set -x in a script that handles keys. Never print whole API responses.
- Run every script that changes something with --dry-run first and show me the plan (read-only ones such
  as check-health.sh and load-env.sh --check have no --dry-run). Use --yes only after I say go.
- Run scripts/secrets/scan-before-push.sh before every push and show me its summary.
- If you see a key anywhere it shouldn't be, stop and tell me which file and line. Don't repeat the value.

Map UI rules (see docs/playbook)
- Every dropdown/menu/popover in the app chrome is rendered with createPortal into document.body,
  backdrop z-[9998], menu z-[9999]. Never "simplify" this into a local absolute dropdown.
- Follow the z-index ladder in docs/playbook/03-menus-on-top.md and update the ladder comment if you add a tier.
- Every string interpolated into Leaflet HTML (divIcon html, string tooltips/popups) goes through esc().
- Overlays are siblings of MapContainer, not children. Map helpers are headless components using useMap().
- Use getPane() || createPane(); decorative panes get pointer-events: none.
- GeoJSON is [lng, lat]; Leaflet is [lat, lng]. Swap deliberately.

Mobile first
- Check every page at 320x568, 390x844, 844x390 (landscape phone) and 1280x800 using a real viewport
  (Playwright), not headless --window-size. No horizontal scroll at any size.
- Touch targets >= 44px. env(safe-area-inset-*) on every edge, including left/right in landscape.
- Tailwind arbitrary calc() values have no spaces.

Definition of done
- Type check and build pass for client and server.
- docker build . passes locally (prompt 01 creates the first Dockerfile; prompt 10 adds CI and compose).
- scripts/secrets/scan-before-push.sh is clean (prompt 01 copies it in from the playbook).
- You opened the app in a real browser and saved screenshots at the four sizes to outbox/.
- Every acceptance check in the prompt passes, and you tell me which ones you could not check.

Safety
- Work on a branch. Small commits with clear messages. Never push to main.
- Never deploy, redeploy, or change production settings without my explicit OK in this session.
- Never create, resize or destroy cloud resources (droplets, IPs, DNS records) without my explicit OK
  in this session, after showing me the --dry-run plan and the cost.
- Production refuses to start without its sign-in settings (fail closed). Never add a bypass.
- Don't delete files in inbox/ without asking.
```

## The prompts

| # | Prompt | Builds | Needs |
|---|---|---|---|
| 01 | [Start a new map app](01-start-a-new-map-app.md) | Repo, client + server, Home + map, satellite basemap, health/about, dev database | none |
| 02 | [Add a layer](02-add-a-layer.md) | A switchable layer with legend, labels, tooltips, URL state | 01 |
| 03 | [Slide-out panel](03-slide-out-panel.md) | Left layers drawer and right list + detail drawer | 01 |
| 04 | [User menu that stays on top](04-user-menu-on-top.md) | Portaled avatar menu, About, feedback, Clear cache & reload | 01 |
| 05 | [Custom icons](05-custom-icons.md) | SVG equipment markers, tile icons, generated app icon set | 01 |
| 06 | [Public share link](06-public-share-link.md) | Lightweight `/s/<token>` viewer, token registry, designs | 01 |
| 07 | [Signed-in-only data](07-signed-in-only-data.md) | `/m/<id>` internal viewer with a view cookie, private extras | 06, 11 (or 16) |
| 08 | [GeoJSON build tool](08-geojson-build-tool.md) | A safe, repeatable Python tool from downloaded files to GeoJSON | none |
| 09 | [Mobile pass](09-mobile-pass.md) | Fixes at 320 / 390 / landscape / desktop with screenshots | any UI |
| 10 | [Dockerize + CI + Portainer](10-dockerize-ci-portainer.md) | Dockerfile, GitHub Actions → GHCR, image-only compose, health | 01 |
| 11 | [OIDC login](11-oidc-login.md) | Sign-in with an identity provider, roles, refresh, logout, fail closed | 01 |
| 12 | [Review and verify](12-review-and-verify.md) | A read-only audit: security, privacy, layering, mobile, caching, build | any |
| 13 | [Host on DigitalOcean](13-host-on-digitalocean.md) | A droplet with firewall, reserved IP, DNS and Caddy, created by `scripts/do/` after a dry run you approve | 10 |
| 14 | [Key-safe scripts](14-key-safe-scripts.md) | One single-purpose script per job that reads its key at run time, plus repo hygiene and the pre-push scan | none |
| 15 | [HTTPS with Caddy](15-https-with-caddy.md) | The Caddy front door (or one more site block), Cloudflare settings, the checks from outside | an app on a server |
| 16 | [Login with Authentik](16-authentik-login.md) | Authentik itself if you need it, then session-cookie sign-in (or forward_auth) that fails closed | 01 (15 on a live server) |

**A sensible order for a new app:** 01 → 02 → 03 → 04 → 16 (or 11) → 10 → 09 → 12, then add 05, 06, 07 and 08 as you need them.

**Putting it online:** 14 first, so no key ever has to go through the chat. Then 15 for HTTPS on your own server (with 10's Portainer deploy), or 13 for a DigitalOcean droplet, which sets up Caddy on the droplet for you. Then run 12 again against the live site.

**16 or 11?** Prompt 16 is the simpler sign-in: the server keeps the user in a session cookie, exactly like `example/server/`. Prompt 11 is the deeper version (variant A in docs/07, tokens in memory), which our field map uses. Prompt 07 is written for 11; with 16, the session cookie already reaches the `/m/` viewer, so tell the agent to use it instead of a separate view cookie.

## Tips for working with the agent

- **Name the doc.** "Read docs/playbook/03-menus-on-top.md first" works far better than "make the menu stay on top".
- **Ask for the plan first** on anything big: "Before you write code, list the files you'll create or change and why."
- **Make it show you.** Screenshots at four sizes, the command output of the build, and the `curl` of `/health`.
- **When it says "simpler",** check that it isn't removing a pattern on purpose: the portal, the safe areas, the `Object.hasOwn`, the fail-closed check.
- **Never paste a key into the chat,** even "just this once". If the agent asks for one, point it at prompt 14 instead.
- **Keep sessions short.** When a session goes in circles, commit what works, start a new session, and paste the prompt again with a note about what's left.
