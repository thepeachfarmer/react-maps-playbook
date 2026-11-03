// @ts-check
// Sign-in with an OIDC identity provider (Authentik, or any other), done by
// the server. The browser only ever holds an HttpOnly session cookie; it
// never sees the IdP's tokens. This is "variant B" in docs/07, and the
// "app does OIDC itself" option in docs/14.
//
//   GET  /api/auth/login?next=/path   start: PKCE + state, then off to the IdP
//   GET  /api/auth/callback           back from the IdP: check, exchange, sign in
//   GET  /api/auth/me                 who am I? 401 when signed out
//   POST /api/auth/logout             end the session, return the IdP logout URL
//
// With sign-in off (the default), /me returns the made-up demo user and
// nothing is protected, exactly like the static demo.

import express from 'express';
import * as client from 'openid-client';
import { ROLES } from './config.js';

/** @typedef {import('./config.js').Config} Config */
/** @typedef {import('./config.js').OidcConfig} OidcConfig */
/** @typedef {import('./config.js').Role} Role */

export const SESSION_COOKIE = 'map.sid';

export const DEMO_USER = { name: 'Demo User', email: 'demo.user@example.com', role: /** @type {Role} */ ('viewer') };

/** Only same-site paths, so ?next= can't bounce people to another site. */
export function safeNext(/** @type {unknown} */ p) {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\') ? p : '/';
}

/**
 * Highest role from the user's IdP groups. null means "not allowed in".
 * @param {OidcConfig} oidc
 * @param {unknown} groups
 * @returns {Role | null}
 */
export function roleFor(oidc, groups) {
  const rank = (/** @type {Role | null} */ r) => (r ? ROLES.indexOf(r) : -1);
  let best = oidc.defaultRole;
  for (const g of Array.isArray(groups) ? groups : []) {
    // Object.hasOwn, not oidc.roleMap[g]: a group called "constructor" must not match.
    const r = typeof g === 'string' && Object.hasOwn(oidc.roleMap, g) ? oidc.roleMap[g] : null;
    if (rank(r) > rank(best)) best = r;
  }
  return best;
}

/** A tiny HTML page for the few errors a person can actually see. */
function page(/** @type {express.Response} */ res, /** @type {number} */ status, /** @type {string} */ title,
  /** @type {string} */ body) {
  res.status(status).type('html').set('Cache-Control', 'no-store').send(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title}</title><body style="font:16px system-ui;max-width:32rem;margin:15vh auto;padding:0 16px">` +
    `<h1 style="font-size:1.3rem">${title}</h1><p>${body}</p></body>`,
  );
}

/**
 * @param {Config} cfg
 * @returns {express.Router}
 */
export function authRouter(cfg) {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');   // never let a browser or CDN cache auth answers
    next();
  });

  // ---- Sign-in off: the demo user, nothing to protect -----------------------
  if (!cfg.oidc) {
    router.get('/me', (_req, res) => res.json({ mode: 'demo', user: DEMO_USER }));
    router.get('/login', (req, res) => res.redirect(safeNext(req.query.next)));
    router.post('/logout', (_req, res) => res.json({ logoutUrl: null }));
    return router;
  }

  const oidc = cfg.oidc;

  // Discovery: read the IdP's /.well-known/openid-configuration once and keep
  // it. Done lazily, so the server still starts (and serves /health) while
  // the IdP is down; a failure is retried on the next sign-in.
  /** @type {Promise<client.Configuration> | undefined} */
  let discovered;
  const idp = () => {
    discovered ??= client
      .discovery(oidc.issuer, oidc.clientId, oidc.clientSecret, undefined,
        oidc.allowHttp ? { execute: [client.allowInsecureRequests] } : undefined)
      .catch((err) => {
        discovered = undefined;
        throw err;
      });
    return discovered;
  };
  idp().then(
    () => console.log(`[auth] OIDC discovery ok: ${oidc.issuer.href}`),
    (err) => console.warn(`[auth] OIDC discovery failed (will retry on next sign-in): ${err.message}`),
  );

  router.get('/login', async (req, res) => {
    const next = safeNext(req.query.next);
    if (req.session.user) return res.redirect(next);

    let config;
    try {
      config = await idp();
    } catch {
      return page(res, 502, 'Can’t reach the sign-in server', 'Try again in a minute.');
    }
    const verifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    req.session.login = { verifier, state, next };

    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: oidc.redirectUri.href,
      scope: oidc.scopes,
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
    });
    // Save BEFORE redirecting. Otherwise the callback can arrive before the
    // session store has the verifier, and sign-in fails with "expired".
    req.session.save((err) => (err ? res.status(500).end() : res.redirect(url.href)));
  });

  router.get('/callback', async (req, res, next) => {
    const pending = req.session.login;
    if (!pending) {
      return page(res, 400, 'That sign-in link has expired', '<a href="/api/auth/login">Sign in again</a>.');
    }
    delete req.session.login;

    if (req.query.error) {
      // e.g. access_denied: the user isn't in a group bound to this app.
      return page(res, 403, 'You don’t have access to this map',
        'Ask an admin to add you to the right group, then <a href="/api/auth/login">try again</a>.');
    }

    // Rebuild the callback URL from the configured redirect URI plus the
    // query string the IdP sent. Never trust Host / X-Forwarded-* headers for it.
    const current = new URL(oidc.redirectUri);
    current.search = new URL(req.originalUrl, 'http://placeholder').search;

    /** @type {Record<string, unknown>} */
    let claims;
    /** @type {string | undefined} */
    let idToken;
    try {
      const config = await idp();
      const tokens = await client.authorizationCodeGrant(config, current, {
        pkceCodeVerifier: pending.verifier,
        expectedState: pending.state,
      });
      claims = { ...tokens.claims() };
      idToken = tokens.id_token;
      if (!claims.sub) throw new Error('no ID token in the response (is "openid" in OIDC_SCOPES?)');
      // Authentik puts name, email and groups in the ID token. Other IdPs may
      // only return them from the userinfo endpoint.
      if (!Array.isArray(claims.groups) || !claims.email) {
        claims = { ...claims, ...(await client.fetchUserInfo(config, tokens.access_token, String(claims.sub))) };
      }
    } catch (err) {
      console.warn(`[auth] callback failed: ${err instanceof Error ? err.message : err}`);
      return page(res, 400, 'Sign-in didn’t work', '<a href="/api/auth/login">Try again</a>.');
    }

    const role = roleFor(oidc, claims.groups);
    if (!role) {
      return page(res, 403, 'You don’t have access to this map',
        'Your account isn’t in any of this map’s groups. Ask an admin to add you.');
    }

    const user = {
      sub: String(claims.sub),
      name: String(claims.name || claims.preferred_username || claims.email || 'User'),
      email: String(claims.email || ''),
      role,
      idToken,
    };

    // A brand-new session id after sign-in, so an id planted before sign-in
    // (session fixation) is worthless.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = user;
      req.session.save((err2) => (err2 ? next(err2) : res.redirect(pending.next)));
    });
  });

  router.get('/me', (req, res) => {
    const u = req.session.user;
    if (!u) return res.status(401).json({ error: 'signed_out' });
    res.json({
      mode: 'oidc',
      user: { name: u.name, email: u.email, role: u.role },
      links: oidc.passkeyUrl ? { passkey: oidc.passkeyUrl } : {},
    });
  });

  // POST only. With SameSite=Lax cookies, another site can't make a signed-in
  // browser send this request (a cross-site POST carries no cookie).
  router.post('/logout', async (req, res, next) => {
    const idToken = req.session.user?.idToken;
    const logoutUrl = await idpLogoutUrl(idToken);
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      res.json({ logoutUrl });
    });
  });

  /**
   * Where the browser goes next, so the IdP session ends too (docs/14).
   * 1. OIDC_LOGOUT_URL if set. For Authentik that's its invalidation flow,
   *    which always signs you out of Authentik itself.
   * 2. Otherwise the standard OIDC end-session endpoint. On Authentik, set
   *    the provider's Invalidation flow to default-invalidation-flow, or this
   *    only ends the app's session and you're signed straight back in.
   * @param {string | undefined} idToken
   */
  async function idpLogoutUrl(idToken) {
    if (oidc.logoutUrl) return oidc.logoutUrl;
    try {
      const config = await idp();
      /** @type {Record<string, string>} */
      const params = { post_logout_redirect_uri: oidc.postLogoutRedirectUri };
      if (idToken) params.id_token_hint = idToken;
      return client.buildEndSessionUrl(config, params).href;
    } catch {
      return '/';
    }
  }

  return router;
}

/**
 * With sign-in on: everything this is mounted in front of needs a session.
 * A page load goes straight to the IdP (no "please sign in" screen) and comes
 * back to where it started. An API call gets a plain 401.
 * @type {express.RequestHandler}
 */
export function requireSignedIn(req, res, next) {
  if (req.session.user) return next();
  if (req.path.startsWith('/api/') || (req.method !== 'GET' && req.method !== 'HEAD')) {
    return res.status(401).json({ error: 'signed_out' });
  }
  res.redirect(`/api/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
}
