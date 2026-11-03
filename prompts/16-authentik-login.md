# 16 · Login with Authentik (optional, and fail closed)

**Use it when:** you don't have an identity provider yet and want one, or you want the simplest sign-in for a map app: the server does OIDC itself and keeps the user in a session cookie, like the playbook's `example/server`. For app-minted tokens in memory, use `11-oidc-login.md` (variant A) instead.
**Fill in:** `<app>` (a short, permanent slug; it ends up in the issuer URL), whether Authentik is **already running** or needs **setting up**, the protection style (**native**: the app does OIDC, the right choice for your own apps; or **forward_auth**: Caddy checks with Authentik, for a tool with no login), and `<DEFAULT_ROLE>` (`none` to refuse people in no group, or `viewer`).
**Read first:** `docs/playbook/14-login-with-authentik.md` (all of it), the "Fail closed in production" section of `docs/playbook/07-auth.md`, and `docs/playbook/13-https-with-caddy.md` if Caddy isn't set up yet.

```text
Goal
Add optional sign-in to <app> through Authentik, using the <native | forward_auth> style from
docs/playbook/14-login-with-authentik.md. Authentik is <already running at auth.example.com |
not set up yet>. Groups <app>-admins, <app>-operators and <app>-viewers map to the roles admin, operator
and viewer; DEFAULT_ROLE=<DEFAULT_ROLE>. Sign-in is OFF in local development by default, and the app
REFUSES TO START in production without it. Read the docs above and the playbook's example/server first,
then show me your plan and the full list of environment variables.

What to build
- If Authentik isn't set up: infra/authentik/ from the playbook (docker-compose.yml with pinned tags,
  PostgreSQL + server + worker, no Redis, no Docker socket, the external "edge" network, secrets as
  ${VAR:?}; .env.example with the secrets empty; README with the first-run steps). The Caddy block for
  auth.example.com with no forward_auth. Don't start it on any shared or production host yourself.
- Native style, in the app's server (Express + openid-client v6 + express-session, like example/server):
  - config: read the env once at startup and throw before listening when: NODE_ENV=production and
    OIDC_ENABLED isn't exactly "true" (unless ALLOW_NO_AUTH=true); a flag that isn't exactly true/false;
    OIDC on with OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET or OIDC_REDIRECT_URI missing;
    production with SESSION_SECRET missing, under 32 characters or a known default; production with an
    http issuer or redirect URI; ROLE_MAP that isn't JSON of group -> viewer|operator|admin. Print each
    problem as "FATAL: ..." (never a secret value) and exit 1.
  - GET /api/auth/login?next=: PKCE (S256) + state saved in the session, session SAVED before the redirect.
    next must start with "/" and not "//" or "/\".
  - GET /api/auth/callback: rebuild the callback URL from OIDC_REDIRECT_URI plus the query string (never
    from Host headers); authorizationCodeGrant with the verifier and state; groups -> role with
    Object.hasOwn over ROLE_MAP, highest wins; no role -> a 403 page; session.regenerate() before storing
    the user (sub, name, email, role, id token); then redirect to next.
  - GET /api/auth/me (401 when signed out) and POST /api/auth/logout (destroy the session, return
    OIDC_LOGOUT_URL if set, else the end-session URL with id_token_hint and post_logout_redirect_uri).
  - Cookie: HttpOnly, SameSite=Lax, Secure in production, 8 h rolling. app.set('trust proxy', 1).
    A persistent session store (connect-redis or connect-pg-simple) if the app has Redis or Postgres.
  - Mount order: /health (reports "auth": "oidc" or "off"), static files, public share pages, session,
    /api/auth, then a gate: no session -> page loads redirect to login with next, API calls get 401.
  - requireRole('operator') on every write and requireRole('admin') on every delete, on the server.
- Native style, in the client: a small auth store that calls /api/auth/me (Accept: application/json),
  redirects to /api/auth/login?next=<this page> on 401, re-checks on visibilitychange and focus, and on
  sign-out POSTs /api/auth/logout and navigates to logoutUrl WITHOUT clearing auth state first. The user
  menu shows name, email and role, "Add a passkey" (OIDC_PASSKEY_URL, new tab) and a real "Sign out".
- Forward_auth style instead: the Caddy snippet from infra/caddy/Caddyfile.example (request_header
  -X-Authentik-* first, then the /outpost.goauthentik.io/* route, then forward_auth, all inside route {}).
  The tool joins the external "edge" network and publishes NO port; Caddy proxies to its container name
  (reverse_proxy <tool-container>:<port>), never to host.docker.internal, so nobody can skip the login.
- docs/AUTH.md for this repo: the Authentik checklist (groups; provider OAuth2/OpenID, Confidential,
  implicit-consent flow, Strict redirect URI, a signing key, scopes openid/email/profile, Invalidation
  flow default-invalidation-flow; bindings for the three groups; or the proxy provider + embedded
  outpost for forward_auth), every env variable with a placeholder value, and the outside checks below.
- Compose for the app: secrets as ${VAR:?}, OIDC_ENABLED as ${OIDC_ENABLED:-true}.

Constraints
- Nothing real in the repo: no client secrets, session secrets, hostnames, group names from my real
  setup, or emails. Placeholders only (example.com). Real values go in the gitignored .env or the
  Portainer stack env.
- Never log tokens, ID tokens, cookies or the session secret. Don't paste them in your output.
- Don't create or change anything in the production Authentik. Give me the exact clicks instead.
- No development bypass that can run in production. No "if OIDC is off, everyone is admin".
- Share links (/s/<token>) and /health stay public.

Acceptance checks
- The app builds, type-checks, and its Docker image builds.
- With NODE_ENV=production: OIDC off refuses to start; OIDC_ENABLED=True refuses; OIDC on with a setting
  missing refuses and lists it; SESSION_SECRET=change-me refuses; ALLOW_NO_AUTH=true starts with a
  WARNING line.
- docker compose config with OIDC_CLIENT_SECRET or SESSION_SECRET unset FAILS with a clear message.
- Signed out, opening /map?layers=fields goes to Authentik and comes back to /map?layers=fields.
- ?next=//evil.example lands on "/".
- A viewer gets 403 on a write; an operator can write but not delete; an admin can do both.
- A user in no mapped group (with DEFAULT_ROLE=none, which is also what an unset DEFAULT_ROLE means) gets
  the "no access" page, not the app.
- Sign out, then open the app again: Authentik asks for credentials.
- curl /health shows "auth":"oidc"; an unauthenticated /api call returns 401; a share link loads
  without signing in.

How to verify (show me)
- The FATAL lines from each refusal above (secrets redacted).
- If you have a test IdP I've approved, or a local mock OIDC provider (never the production Authentik):
  the sign-in round trip with the redirect chain and the /api/auth/me response.
- The curl outputs for /health, the 401 and the share link.
- Screenshots of the user menu, signed in, at 390x844 and 1280x800, saved to outbox/.
- The list of Authentik settings I need to enter, in order.
```
