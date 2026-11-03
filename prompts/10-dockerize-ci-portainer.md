# 10 · Dockerize + CI + Portainer deploy

**Use it when:** the app runs locally and you want merges to `main` to produce an image that your server can pull.
**Fill in:** `<owner>` (your GitHub user or org, used only in `ghcr.io/<owner>/<app>`), `<app>`, `<host-port>`.
**Read first:** `docs/playbook/08-deploy.md` (all of it), and `docs/playbook/07-auth.md` section "Fail closed in production".
**Signing secret:** an app signed in with prompt 16 (or `example/server`) uses `SESSION_SECRET`; one built with prompt 11 uses `JWT_SECRET`. Wherever this prompt says `<SIGNING_SECRET>`, use the one your app has.

```text
Goal
Package this app as one Docker image, build and push it to GHCR from GitHub Actions on every merge to main,
and make docker-compose.yml deployable as a Portainer "stack from Git repository" that pulls that image.
Read docs/playbook/08-deploy.md and the "Fail closed" section of docs/playbook/07-auth.md first.

What to build
- Dockerfile (multi-stage; extend the one prompt 01 made, or create it): client-build (node:22-alpine, npm ci,
  vite build) -> server-build (npm ci, tsc) -> runtime (npm ci --omit=dev, server/dist, client/dist,
  migrations, data/). ARG/ENV APP_VERSION, COMMIT_SHA, BUILT_AT; NODE_ENV=production; EXPOSE 3000;
  CMD node server/dist/index.js. No inline comments after instructions (Dockerfiles don't support them).
- .dockerignore: node_modules, dist, .git, .env, .env.*, *.env, secrets, *.pem, *.key, *.log, inbox, outbox.
  secrets/ holds the scanner's denylist and any key file that isn't named *.env, and COPY . . would bake
  them into the image.
- .github/workflows/build.yml: on push and pull_request to main. permissions contents:read, packages:write.
  checkout with fetch-depth 0; version = 1.0.<git rev-list --count HEAD>; setup-buildx; login to ghcr.io
  with GITHUB_TOKEN (skipped on PRs); metadata-action tags (latest on the default branch, branch, sha);
  build-push-action (push only when it isn't a PR) with build args APP_VERSION, COMMIT_SHA and BUILT_AT;
  gha cache.
- docker-compose.yml (production, image-only, NO build:):
  - app: image ghcr.io/<owner>/<app>:${IMAGE_TAG:-latest}, ports "<host-port>:3000", every variable listed
    explicitly under environment: with ${VAR}. Secrets and client IDs use ${VAR:?message}. OIDC_ENABLED uses
    ${OIDC_ENABLED:-true}. depends_on db and redis with condition: service_healthy. restart unless-stopped.
  - db: postgis/postgis:16-3.4 with a pg_isready healthcheck and a named volume.
  - redis: redis:7-alpine with a redis-cli ping healthcheck.
- docker-compose.override.yml (local only; Portainer ignores it): build: . and dev-only settings.
- .env.example listing every variable with empty values.
- The server's startup fail-closed check, if it isn't there yet: refuse to start in production when OIDC is
  off or <SIGNING_SECRET> is missing or a known default. That's loadConfig() as in the playbook's
  example/server/config.js for a prompt-16 app (SESSION_SECRET), or assertAuthConfig() from docs/07 for a
  prompt-11 app (JWT_SECRET).
- /health and /api/about reading APP_VERSION, COMMIT_SHA, BUILT_AT and STARTED_AT (add them if missing).
- docs/DEPLOY.md for this repo, covering:
  - the Portainer steps (Stacks > Add stack > Repository, refs/heads/main, docker-compose.yml, "Re-pull image"
    ON, registry credentials if the package is private)
  - the full environment variable list
  - how to read built_at and started_at after a redeploy
  - how to roll back by pinning IMAGE_TAG to a sha tag
  - the warning that any API redeploy must send the env list back unchanged

Constraints
- No real secrets, hostnames or owner names anywhere. Use placeholders in docs.
- Never use env_file: in docker-compose.yml. Never give a secret a :- default.
- Do NOT deploy or call any Portainer API. Stop after the local checks and tell me what to do in Portainer.
- If the image will contain real data (data/), tell me so I can keep the GHCR package private.

Acceptance checks
- docker build -t <app>:local . passes; docker build --no-cache --target client-build . passes; and the same
  for server-build.
- docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --build starts all three
  services healthy, and curl localhost:<host-port>/health returns 200 with the version.
- docker compose -f docker-compose.yml config with <SIGNING_SECRET> unset FAILS with the clear message.
- Starting the image with NODE_ENV=production and OIDC_ENABLED=false exits with the FATAL message.
- The workflow passes on a pull request (build only, no push).
- The final image doesn't contain .env, secrets/, inbox/, outbox/ or .git (check with
  docker run --rm <app>:local ls -la /app).

How to verify (show me)
- The output of each command above (with any secret values redacted).
- docker images showing the image size.
- The link to the green CI run on the PR.
```
