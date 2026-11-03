# Caddy: the front door

Caddy is the only container on ports 80 and 443. It gets HTTPS certificates by itself, renews them by itself, and forwards each hostname to the right app. The full explanation is in [docs/13-https-with-caddy.md](../../docs/13-https-with-caddy.md). This folder is the copy-paste part.

| File | What it is |
|---|---|
| `Caddyfile.example` | One app, several apps, a forward_auth app, and a commented Cloudflare DNS-01 wildcard variant |
| `docker-compose.yml` | The Caddy service, ready to run: plain Caddy, with the Cloudflare lines commented |
| `.env.example` | `CLOUDFLARE_API_TOKEN`, empty. Only the Cloudflare variant needs a `.env` |
| `.gitignore` | Keeps `.env`, `conf/` and a real `Caddyfile` (your real hostnames) out of git |
| `README.md` | This page: the compose file, the Cloudflare build, and the checklists |

Everything here uses placeholders (`example.com`, `203.0.113.10`). Put real values only in your own private config.

## Layout on the server

```
edge/
├── docker-compose.yml     the Caddy service (this folder's docker-compose.yml)
├── .env                   gitignored. Only needed for the Cloudflare variant (.env.example)
└── conf/
    └── Caddyfile          copied from Caddyfile.example and edited
```

Mount the **folder** `conf/`, not the single file. Most editors save by writing a new file and renaming it, and a single-file bind mount keeps showing the container the old one.

## Plain Caddy (sections 1 to 3 of the example)

This is what `docker-compose.yml` in this folder holds:

```yaml
# edge/docker-compose.yml
services:
  caddy:
    image: caddy:2.11-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"          # HTTP/3
    extra_hosts:
      # Lets the Caddyfile say host.docker.internal:8080 for apps that
      # publish a port on this host.
      - "host.docker.internal:host-gateway"
    volumes:
      - ./conf:/etc/caddy:ro
      - caddy_data:/data       # certificates and the ACME account. Never delete it.
      - caddy_config:/config
    networks:
      - edge

volumes:
  caddy_data: {}
  caddy_config: {}

networks:
  edge:
    external: true             # docker network create edge   (once per host)
```

First start:

```sh
docker network create edge                 # once; Authentik and some apps join it too
cp Caddyfile.example conf/Caddyfile        # then edit the hostnames and ports
docker run --rm -v "$PWD/conf:/etc/caddy" caddy:2.11-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d
docker compose logs -f caddy               # look for "certificate obtained successfully"
```

After you edit the Caddyfile:

```sh
docker run --rm -v "$PWD/conf:/etc/caddy" caddy:2.11-alpine caddy fmt --overwrite /etc/caddy/Caddyfile   # tidy (optional)
docker compose exec -w /etc/caddy caddy caddy reload      # zero downtime; refuses a broken file
```

`caddy reload` checks the new file before it swaps it in. If the file is broken, the old config keeps running and the command prints the error.

## Behind Cloudflare with DNS-01 (section 4 of the example)

DNS-01 needs Caddy **built with the Cloudflare DNS plugin**. The stock image fails with `module not registered: dns.providers.cloudflare`. Build your own image:

```dockerfile
# edge/Dockerfile
FROM caddy:2.11-builder AS build
RUN xcaddy build --with github.com/caddy-dns/cloudflare@v0.2.4

FROM caddy:2.11-alpine
COPY --from=build /usr/bin/caddy /usr/bin/caddy
COPY conf/Caddyfile /etc/caddy/Caddyfile
```

Then change the compose service:

```yaml
services:
  caddy:
    image: ghcr.io/<owner>/caddy-cloudflare:latest   # built by CI from the Dockerfile above
    environment:
      # Required: compose refuses to start without it, instead of starting Caddy
      # with an empty token that fails every renewal.
      CLOUDFLARE_API_TOKEN: ${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN in .env or the stack env}
    # ...ports, extra_hosts, volumes and networks as above, but WITHOUT the
    # ./conf bind mount: the Caddyfile is inside the image now.
```

In `docker-compose.yml` that's the commented `image:` and `environment:` lines; `.env.example` has the variable, empty.

**Why bake the Caddyfile into the image?** A Portainer "stack from Git" can't build images, and bind-mounting files from the cloned repo is unreliable there (docs/08). So CI builds the image with the Caddyfile inside, and a Caddyfile change ships like any app change: merge, wait for CI, redeploy with **Re-pull image** on. On a plain host with `docker compose`, the bind-mount layout above works fine with the plugin build too.

**The token:**

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token** → the **Edit zone DNS** template.
2. Permissions: **Zone · Zone · Read** and **Zone · DNS · Edit**. Zone resources: **Include → Specific zone → example.com**. No other zones, no account permissions.
3. Put it in `edge/.env` (gitignored) as `CLOUDFLARE_API_TOKEN=...`, or in the Portainer stack's environment variables. Never in the Caddyfile, the Dockerfile, a commit or a chat.
4. Check that the container got it without printing it:
   `docker compose exec caddy sh -c 'test -n "$CLOUDFLARE_API_TOKEN" && echo token is set'`

If the variable is missing, Caddy refuses to start with `API token '' appears invalid`. That's the fail-closed behaviour you want.

**Validating a Caddyfile that uses `dns cloudflare`** needs the plugin build and *some* token, because Caddy checks the token's format while it loads the config. Use an obviously fake one:

```sh
docker run --rm -e CLOUDFLARE_API_TOKEN=validate-only-not-a-real-token-000000000 \
  -v "$PWD/conf:/etc/caddy" ghcr.io/<owner>/caddy-cloudflare:latest \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

## Checklist: a new app behind Caddy

- [ ] DNS: an A record for `app.example.com` pointing at the server's public IP (`dig +short app.example.com`). With the Cloudflare wildcard, nothing to add.
- [ ] The app's container publishes its port on the host (`"8080:80"`), or joins the `edge` network so Caddy can use its container name.
- [ ] A forward_auth tool **always** joins the `edge` network and publishes **no** port, so nobody can reach it without going through Caddy and the login (section 3 of `Caddyfile.example`).
- [ ] A site block (or an `@app host` matcher under the wildcard) with `import common` and `reverse_proxy`.
- [ ] `caddy validate` passes, then `caddy reload` (or CI build + redeploy for a baked image).
- [ ] `curl -sI https://app.example.com` returns the app's status, with `strict-transport-security` in the headers.
- [ ] An app that does its own sign-in has `app.set('trust proxy', 1)` (Express) or the FastAPI equivalent (docs/07).
- [ ] The app uses exactly one way to sign in: its own OIDC **or** forward_auth. Never both on one hostname.

## Checklist: first time on a new server

- [ ] Ports 80 and 443 (TCP) and 443 (UDP) are open in the host firewall, the cloud firewall and any router port-forward. DNS-01 only needs 443.
- [ ] `email` is set in the global options.
- [ ] Testing? Turn on the staging `acme_ca` line until certificates come through, then remove it and restart.
- [ ] The `caddy_data` volume is a named volume that survives redeploys. Losing it means re-issuing every certificate, which is how people hit rate limits.
- [ ] Behind Cloudflare: SSL/TLS mode is **Full (strict)**.
