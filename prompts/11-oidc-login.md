# 11 · OIDC login (with an identity provider such as Authentik)

**Use it when:** the app should sign people in through your identity provider, with roles from groups.
**Fill in:** `<app>`, the group names you'll create in the IdP (e.g. `<app>-admins`, `<app>-operators`), and whether you want **variant A** (app-minted tokens kept in memory) or **variant B** (a server-side session cookie). Not sure? Use A for a map-heavy SPA that also uses the `/m/` viewer, and B for a simple dashboard.
**Read first:** `docs/playbook/07-auth.md` (all of it).

```text
Goal
Add sign-in to <app> through our OIDC identity provider using variant <A or B> from docs/playbook/07-auth.md.
Roles come from IdP groups: <app>-admins -> admin, <app>-operators -> operator, everyone else -> viewer.
There's no sign-in button screen: a signed-out visitor goes straight to the IdP and comes back where they
started. Read docs/playbook/07-auth.md first, then show me your plan and the list of env variables.

What to build (variant A)
- Server routes, with exactly these paths (the client and the checks below use them):
    GET  /api/auth/oidc/login               random 32-byte state in Redis (10-minute expiry), plus PKCE
    GET  /api/auth/oidc/callback            check and delete the state, exchange the code, userinfo,
                                            groups -> role (ROLE_MAP JSON env with Object.hasOwn, highest
                                            wins; DEFAULT_ROLE unset means none, so no mapped group = a
                                            "no access" page and no tokens), read sid, record a session
                                            row, sign an access JWT (15 min) and a refresh JWT (7 days)
                                            carrying sid and type, store them in Redis under a one-time
                                            key, redirect to /?oidc_session=<key>
    POST /api/auth/oidc/exchange            swap the key for the tokens, delete the key
    POST /api/auth/oidc/refresh             new tokens for a valid refresh token; 400/401 when it isn't
    POST /api/auth/oidc/logout              revoke the sid, return the IdP logout URL
    GET  /api/auth/oidc/enabled             true or false
    POST /api/auth/oidc/backchannel-logout  the IdP's server-to-server logout (below)
- Client: tokens in memory only. Save the return path in sessionStorage before leaving, and accept it only if
  it starts with "/" and not "//" or "/\". Refresh (POST /api/auth/oidc/refresh) 1 minute before expiry;
  on network failure retry after 5s, 15s, then every minute; also refresh on visibilitychange and online. Only a 400/401 from refresh
  sends the user to sign in. The API wrapper refreshes once on a 401 and retries the request.
(Variant B instead: login saves the PKCE verifier and state in the session and SAVES the session before
redirecting; callback stores the user in a server-side session store that can be looked up by sid; /me;
an AuthContext that re-checks on focus and visibilitychange.)

Both variants
- authenticate and requireRole(...roles) middleware. Roles are enforced on the server for every write
  (operator+) and delete (admin). The client hides buttons only as a convenience.
- Logout: POST revokes the session (sid) and returns the IdP's logout URL. For Authentik that's
  <issuer origin>/if/flow/default-invalidation-flow/. The client navigates there immediately, without
  clearing auth state first.
- Back-channel logout: POST /api/auth/oidc/backchannel-logout (form-encoded logout_token) verified against
  the IdP's JWKS with jose's createRemoteJWKSet (OIDC_JWKS_URL, or the jwks_uri read from the issuer's
  discovery document at startup). Check issuer and audience; reject a nonce; require the back-channel
  logout event; keep a jti replay cache; revoke the sid. authenticate refuses revoked sids. Mount it outside authenticate.
- Fail closed: assertAuthConfig() at startup (production + OIDC off, or a known default JWT_SECRET, means
  throw); authenticate returns 503 in production when OIDC is off; the dev bypass (local admin) exists only
  when NODE_ENV isn't production. Compose: secrets use ${VAR:?}, OIDC_ENABLED uses ${OIDC_ENABLED:-true}.
- Mount order: /api/auth, /api/about, /health, /api/share (public), webhooks (explicit carve-out), then
  everything else behind authenticate. app.set('trust proxy', 1).
- If there's a service worker, confirm it never touches /api/*.
- The user menu (prompt 04) shows the name, email and role, and Log out works.
- docs/AUTH.md for this repo: what to create in the IdP (a confidential OAuth2/OIDC provider, a strict
  redirect URI https://<app>.example.com/api/auth/oidc/callback, the "groups" scope mapping attached,
  the groups bound to the application), and every env variable with a placeholder value: OIDC_ENABLED,
  OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI, OIDC_JWKS_URL (optional when
  read from discovery), JWT_SECRET, ROLE_MAP, DEFAULT_ROLE, REDIS_URL.

Constraints
- The IdP URL, client ID, client secret and ROLE_MAP come from env variables. Nothing real in the repo.
- No tokens in localStorage, URLs (except the one-time key), or logs.
- Don't touch the production IdP or production env. Give me the exact settings to enter myself.

Acceptance checks
- Signed out, opening /map?layers=x goes to the IdP and comes back to /map?layers=x.
- A viewer can read but gets 403 on writes. An operator can write but not delete. An admin can do both.
- Leaving the tab in the background past the access-token lifetime, then returning, keeps you signed in.
- Logout ends the IdP session: opening the app again asks for credentials.
- ?next=//evil.example falls back to "/".
- NODE_ENV=production with OIDC_ENABLED=false refuses to start. Unauthenticated GET /api/fields returns 401.
  /api/auth/oidc/enabled returns true.

How to verify (show me)
- A short written walkthrough with screenshots: signed out, at the IdP, back in the app with the menu open.
- curl outputs for the 401, the 403 (as a viewer) and /api/auth/oidc/enabled.
- The startup log line from the fail-closed check.
```
