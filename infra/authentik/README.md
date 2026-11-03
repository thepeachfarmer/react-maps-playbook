# Authentik: one login for every app

Authentik is a self-hosted, open-source identity provider (IdP). People sign in once at `auth.example.com`, and every app trusts that sign-in through OIDC. The why and the how are in [docs/14-login-with-authentik.md](../../docs/14-login-with-authentik.md). This folder is the part you run.

| File | What it is |
|---|---|
| `docker-compose.yml` | PostgreSQL, the Authentik server and the Authentik worker. Pinned image tags, no Redis (not needed since 2025.10) |
| `.env.example` | The variables, with the secrets left empty so nothing starts until you set them |
| `README.md` | First run, then a checklist for each app you connect |

It expects Caddy in front (see [../caddy](../caddy)) on a shared Docker network called `edge`. Authentik doesn't publish a port on the host.

## First run

1. **DNS and Caddy.** Point `auth.example.com` at the server and add the `auth.example.com` block from `../caddy/Caddyfile.example`. Don't put forward_auth on it.
2. **The shared network,** once per host:
   ```sh
   docker network create edge
   ```
3. **Secrets.** Do this step yourself, not the agent. Copy `.env.example` to `.env` and write the two secrets straight into it, so they never show on the screen, in a chat or in a transcript:
   ```sh
   cp .env.example .env && chmod 600 .env
   # drop the two empty lines, then append generated values. printf is a shell builtin,
   # so the values never appear on a command line or in the output.
   sed -i.bak -e '/^PG_PASS=$/d' -e '/^AUTHENTIK_SECRET_KEY=$/d' .env && rm .env.bak
   printf 'PG_PASS=%s\n' "$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)" >> .env
   printf 'AUTHENTIK_SECRET_KEY=%s\n' "$(openssl rand -base64 60 | tr -dc 'A-Za-z0-9')" >> .env
   ```
   The values are letters and digits only, so they survive any quoting. For Portainer, open `.env` in your editor and copy the two lines into the stack's environment variables yourself. Copy both into your password manager the same way. **Never change `AUTHENTIK_SECRET_KEY` after the first start.**
4. **Check the file, then start:**
   ```sh
   docker compose config --quiet && echo OK     # fails with a clear message if a secret is missing
   docker compose up -d
   docker compose ps                            # wait for authentik-server to be "healthy" (about a minute)
   ```
5. **Create the admin straight away.** Open `https://auth.example.com/if/flow/initial-setup/` and set the email and password for `akadmin`. Until you do, **anyone who finds that page can become the admin.** If the server is already public, do this the moment it's up. Or do it before DNS points here: uncomment the `127.0.0.1:9000` port in the compose file, tunnel in with `ssh -L 9000:127.0.0.1:9000 you@your-server`, and open `http://localhost:9000/if/flow/initial-setup/`.
6. **Make yourself a real admin.** Directory → Users → Create a user for yourself and add it to the **authentik Admins** group. Sign in as that user, enroll a passkey (below), then deactivate `akadmin` or give it a long random password kept offline.
7. **Back it up.** Everything is in PostgreSQL. A nightly dump plus the secret key is a full backup:
   ```sh
   docker compose exec -T authentik-db pg_dump -U authentik authentik | gzip > authentik-$(date +%F).sql.gz
   ```

**Upgrades:** change `AUTHENTIK_TAG` one release at a time (2026.5 → 2026.8, not 2026.2 → 2026.8), read that release's *Breaking changes* first, back up, then `docker compose pull && docker compose up -d`.

## Checklist: connect an app (the app does OIDC itself)

This is how the map apps in this playbook sign in, and what `example/server` expects. Do it once per app. Replace `<app>` with a short, permanent slug such as `fieldmap`. The slug becomes part of the issuer URL, so renaming it later breaks every config that uses it.

**Groups** (Directory → Groups → Create):

- [ ] `<app>-admins` → the app's **admin** role
- [ ] `<app>-operators` → **operator**
- [ ] `<app>-viewers` → **viewer**. People who may sign in but only look.

**Application and provider** (Applications → Applications → **Create with provider**):

- [ ] Application name `<App name>`, slug `<app>`.
- [ ] Provider type **OAuth2/OpenID Provider**.
- [ ] Authorization flow: `default-provider-authorization-implicit-consent`, so your own apps don't show a consent screen.
- [ ] Client type **Confidential**. Copy the **Client ID** and **Client Secret** now.
- [ ] Redirect URIs, mode **Strict**: `https://<app>.example.com/api/auth/callback`. It must match exactly: https, host, path, no trailing slash. For local testing, add `http://localhost:3000/api/auth/callback` as a second entry.
- [ ] Signing key: **authentik Self-signed Certificate** (or any certificate). With no signing key, Authentik signs tokens with the client secret (HS256) and publishes no public key, so anything that verifies tokens against its JWKS (back-channel logout, docs/07) fails.
- [ ] Advanced protocol settings → Scopes: keep `openid`, `email` and `profile`. Authentik's default `profile` mapping already includes a `groups` claim. If you replaced it, add a mapping that returns `{"groups": [g.name for g in request.user.groups.all()]}`.
- [ ] Advanced flow settings → **Invalidation flow: `default-invalidation-flow`**. The default, `default-provider-invalidation-flow`, only ends the app's session and leaves people signed in to Authentik, so "Sign out" looks broken (docs/14).

**Who may sign in at all** (Applications → `<App name>` → Policy / Group / User Bindings):

- [ ] Bind `<app>-admins`, `<app>-operators` and `<app>-viewers`. **Without bindings, every Authentik user can sign in to every app.**

**Hand the settings to the app** (the stack's environment, never the repo):

```sh
OIDC_ENABLED=true
OIDC_ISSUER_URL=https://auth.example.com/application/o/<app>/
OIDC_CLIENT_ID=<from the provider page>
OIDC_CLIENT_SECRET=<from the provider page>
OIDC_REDIRECT_URI=https://<app>.example.com/api/auth/callback
SESSION_SECRET=<openssl rand -hex 32>
ROLE_MAP={"<app>-admins":"admin","<app>-operators":"operator","<app>-viewers":"viewer"}
DEFAULT_ROLE=none
OIDC_LOGOUT_URL=https://auth.example.com/if/flow/default-invalidation-flow/
OIDC_PASSKEY_URL=https://auth.example.com/if/flow/default-authenticator-webauthn-setup/
```

**Test it:**

- [ ] `curl -s https://auth.example.com/application/o/<app>/.well-known/openid-configuration | head -c 300` shows JSON whose `issuer` is exactly your `OIDC_ISSUER_URL`.
- [ ] Opening the app signed out goes to Authentik and comes back to the page you asked for.
- [ ] A user in none of the three groups gets Authentik's "permission denied", not the app.
- [ ] Sign out, then open the app again: Authentik asks for your password or passkey.
- [ ] Group changes take effect after the user signs out and back in.

## Checklist: protect an app that has no login (forward_auth)

For off-the-shelf tools with no sign-in of their own. Caddy asks Authentik's built-in outpost before every request. Never use this on an app that already does OIDC itself.

- [ ] Applications → Applications → **Create with provider** → **Proxy Provider**.
- [ ] Mode **Forward auth (single application)**, external host `https://tools.example.com`.
- [ ] Bind the groups that may use it, as above.
- [ ] Applications → **Outposts** → *authentik Embedded Outpost* → Edit → add the application → Update.
- [ ] In the Caddyfile, wrap the site in `route { import authentik_forward_auth … }` (section 3 of `Caddyfile.example`).
- [ ] Sign-out link for that tool: `https://tools.example.com/outpost.goauthentik.io/sign_out`.
- [ ] The tool joins the `edge` network and publishes **no** port at all (no `ports:` line), and Caddy proxies to its container name (`reverse_proxy tools-app:8090`). A published port, even one you meant to firewall, lets people reach the tool without going through Caddy, and they skip the login.

## Passkeys

- [ ] Each person enrolls at `https://auth.example.com/if/flow/default-authenticator-webauthn-setup/`, or under their user settings → MFA devices. Enroll two: a phone and a laptop, or a hardware key as a spare.
- [ ] To sign in with a passkey instead of a password: Flows & Stages → Stages → edit **default-authentication-identification** → set **WebAuthn Authenticator Validation Stage** to **default-authentication-mfa-validation** (open that stage first and check that *WebAuthn* is ticked under device classes). The browser then offers the passkey as soon as someone taps the username box.
- [ ] Passkeys are tied to the hostname `auth.example.com`. Move Authentik to a new hostname and everyone has to enroll again.
