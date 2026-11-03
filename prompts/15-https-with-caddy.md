# 15 · HTTPS with Caddy (and Cloudflare in front)

**Use it when:** an app runs on your server and you want it at `https://<app>.example.com` with a real certificate. Or you're setting up the shared front door for all your apps for the first time.
**Fill in:** `<app>`, `<host-port>` (the port the app publishes on the Docker host), and whether your DNS is on **Cloudflare** (then use one wildcard certificate through DNS-01) or **somewhere else** (then one certificate per hostname through ports 80/443). Also say whether the edge already exists (just add a block) or not (build it).
**Read first:** `docs/playbook/13-https-with-caddy.md` (all of it), and the Caddy section of `docs/playbook/08-deploy.md`.

```text
Goal
Serve <app> at https://<app>.example.com through Caddy, the single front door on ports 80/443.
DNS is on <Cloudflare | another provider>. The edge stack <already exists | doesn't exist yet>.
Read docs/playbook/13-https-with-caddy.md and infra/caddy/ in the playbook first, then show me your plan:
the files you'll create or change, and every setting I have to make by hand (DNS, firewall, Cloudflare).

What to build
- If the edge doesn't exist yet, an edge/ folder (its own repo, or infra/caddy/ in this one):
  - conf/Caddyfile built from the playbook's infra/caddy/Caddyfile.example: global options with an email,
    the commented staging acme_ca line, the (common) snippet (encode zstd gzip, HSTS without
    includeSubDomains, nosniff, Referrer-Policy strict-origin-when-cross-origin, -Server, log), and a
    final 404 for unknown names if you use a wildcard.
  - docker-compose.yml: caddy:2.11-alpine (or the Cloudflare build below), ports 80, 443 and 443/udp,
    extra_hosts host.docker.internal:host-gateway, named volumes caddy_data and caddy_config, the
    external network "edge", restart unless-stopped. Mount the conf/ FOLDER, not the single file.
  - Cloudflare only: a Dockerfile that builds Caddy with xcaddy and github.com/caddy-dns/cloudflare
    (pinned version), copies conf/Caddyfile in, and a CI workflow that pushes it to GHCR like the apps
    (docs/08). CLOUDFLARE_API_TOKEN comes from the environment as ${CLOUDFLARE_API_TOKEN:?...}.
    The Caddyfile reads it as {env.CLOUDFLARE_API_TOKEN}. The wildcard block uses tls { dns cloudflare ...;
    resolvers 1.1.1.1 } and one @matcher + handle per app.
  - .gitignore with .env, and a .env.example listing CLOUDFLARE_API_TOKEN with an empty value.
- The site block (or @matcher under the wildcard) for <app>: import common, reverse_proxy
  host.docker.internal:<host-port>. WebSockets and /api routes need nothing special; use handle blocks if
  the app has several containers.
- The app side: if it's Express, app.set('trust proxy', 1). Check that its cookies are Secure in
  production and that it never builds absolute URLs from the Host header without need.
- docs/HTTPS.md for this repo: the DNS record to create, the ports to open, the Cloudflare settings
  (SSL/TLS mode Full (strict); proxied or DNS only, and why), how to validate and reload, and the
  common-mistakes table from the playbook trimmed to what applies here.

Constraints
- Never put a token, key or real hostname in the repo, a Caddyfile, a Dockerfile, a commit message or
  your output. The Cloudflare token is scoped to Zone:Zone:Read + Zone:DNS:Edit for one zone, and
  lives only in the gitignored .env or the Portainer stack env.
- Don't change DNS, Cloudflare, the firewall or the production edge yourself. Give me the exact steps.
- Use the staging acme_ca line until the first certificate works, so failures don't hit rate limits.
- Never delete or recreate the caddy_data volume.
- Never put forward_auth in front of auth.example.com, or in front of an app that does its own OIDC.
- Cloudflare SSL/TLS mode Flexible is never acceptable.

Acceptance checks
- caddy validate passes on every Caddyfile you wrote (for the Cloudflare build, run it with the plugin
  image and a fake token like validate-only-not-a-real-token-000000000).
- docker compose config passes, and with CLOUDFLARE_API_TOKEN unset it FAILS with the clear message
  (Cloudflare variant only).
- After I've made the DNS/firewall changes: curl -sI https://<app>.example.com shows the app's
  response with strict-transport-security; http:// redirects to https://.
- The origin certificate is from Let's Encrypt (openssl s_client, or curl --resolve to the server's IP
  when the record is proxied), and its expiry is about 90 days out.
- An unknown subdomain under the wildcard returns 404.
- Signing in to the app works with no redirect loop, and its session cookie is Secure.

How to verify (show me)
- The output of caddy validate and docker compose config.
- The Caddy log line "certificate obtained successfully" for the hostname (no tokens in what you paste).
- The curl and openssl outputs above.
- The exact list of manual steps you need from me, in order.
```
