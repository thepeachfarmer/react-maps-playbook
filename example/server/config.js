// @ts-check
// Reads the environment once, checks it, and REFUSES TO START when the
// combination is unsafe. This is the "fail closed" rule from docs/07 and
// docs/14. We once ran a production app wide open after a redeploy wiped its
// environment: the "sign-in enabled" flag fell back to off, and so did
// everything that depended on it. Here, a lost environment means a container
// that won't start, which someone notices within minutes.
//
// The rules:
//   - NODE_ENV=production with sign-in off -> refuse, unless ALLOW_NO_AUTH=true
//     is set on purpose (a public demo with nothing to protect).
//   - Sign-in on -> every OIDC setting must be present and well-formed.
//   - Sign-in on in production -> https only, and a long, non-default
//     SESSION_SECRET.
//   - A flag that isn't exactly "true" or "false" ("True", "1", "yes") is a
//     mistake, not a guess.
//   - DEFAULT_ROLE unset -> "none": someone in no mapped group is refused.
//     By default every Authentik user can sign in to every app, so one
//     forgotten binding must not let the whole directory in. "viewer" is
//     allowed, but only when you set it on purpose.
// None of the messages print secret values.

import { randomBytes } from 'node:crypto';

/** @typedef {'viewer' | 'operator' | 'admin'} Role */
/** @type {readonly Role[]} */
export const ROLES = ['viewer', 'operator', 'admin'];

// Values people paste from examples. Refused as a SESSION_SECRET in production.
const KNOWN_DEFAULT_SECRETS = new Set([
  'change-me', 'changeme', 'change-me-please', 'secret', 'dev-secret', 'dev-only',
  'session-secret', 'your-session-secret', 'replace-me', 'example', 'password',
]);
const MIN_SECRET_LENGTH = 32;
const CALLBACK_PATH = '/api/auth/callback';

/**
 * @typedef {object} OidcConfig
 * @property {URL} issuer
 * @property {string} clientId
 * @property {string} clientSecret
 * @property {URL} redirectUri
 * @property {string} postLogoutRedirectUri
 * @property {string | undefined} logoutUrl       Authentik: its invalidation flow (docs/14)
 * @property {string | undefined} passkeyUrl      shown as "Add a passkey" in the menu
 * @property {string} scopes
 * @property {Record<string, Role>} roleMap       IdP group name -> role
 * @property {Role | null} defaultRole            null = refuse users in no mapped group
 * @property {boolean} allowHttp                  dev only: an http:// issuer on localhost
 */

/**
 * @typedef {object} Config
 * @property {boolean} production
 * @property {number} port
 * @property {'oidc' | 'off'} auth
 * @property {OidcConfig | null} oidc
 * @property {string} sessionSecret
 * @property {string[]} warnings
 */

export class ConfigError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(problems.join('\n'));
    this.problems = problems;
  }
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {Config}
 */
export function loadConfig(env = process.env) {
  /** @type {string[]} */ const problems = [];
  /** @type {string[]} */ const warnings = [];
  const get = (/** @type {string} */ name) => (env[name] ?? '').trim();

  const flag = (/** @type {string} */ name) => {
    const v = get(name);
    if (v === '' || v === 'false') return false;
    if (v === 'true') return true;
    problems.push(`${name} must be "true" or "false" (it is set to something else).`);
    return false;
  };

  const production = get('NODE_ENV') === 'production';
  const oidcOn = flag('OIDC_ENABLED');
  const allowNoAuth = flag('ALLOW_NO_AUTH');

  const port = Number(get('PORT') || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('PORT must be a port number.');

  /** @type {OidcConfig | null} */
  let oidc = null;
  let sessionSecret = '';

  if (oidcOn) {
    const required = (/** @type {string} */ name) => {
      const v = get(name);
      if (!v) problems.push(`${name} is required when OIDC_ENABLED=true.`);
      return v;
    };
    const url = (/** @type {string} */ name, /** @type {string} */ value) => {
      if (!value) return null;
      try {
        return new URL(value);
      } catch {
        problems.push(`${name} is not a valid URL.`);
        return null;
      }
    };

    const issuer = url('OIDC_ISSUER_URL', required('OIDC_ISSUER_URL'));
    const clientId = required('OIDC_CLIENT_ID');
    const clientSecret = required('OIDC_CLIENT_SECRET');
    const redirectUri = url('OIDC_REDIRECT_URI', required('OIDC_REDIRECT_URI'));

    if (redirectUri && redirectUri.pathname !== CALLBACK_PATH) {
      problems.push(`OIDC_REDIRECT_URI must end in ${CALLBACK_PATH} (that's where this server listens).`);
    }
    if (production) {
      if (issuer && issuer.protocol !== 'https:') problems.push('OIDC_ISSUER_URL must use https in production.');
      if (redirectUri && redirectUri.protocol !== 'https:') {
        problems.push('OIDC_REDIRECT_URI must use https in production (the session cookie is Secure).');
      }
    }

    // Group -> role map, e.g. {"maps-admins":"admin","maps-operators":"operator"}
    /** @type {Record<string, Role>} */
    const roleMap = Object.create(null);
    const rawMap = get('ROLE_MAP');
    if (rawMap) {
      try {
        const parsed = JSON.parse(rawMap);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        for (const [group, role] of Object.entries(parsed)) {
          if (!ROLES.includes(/** @type {Role} */ (role))) throw new Error(`unknown role for ${group}`);
          roleMap[group] = /** @type {Role} */ (role);
        }
      } catch {
        problems.push('ROLE_MAP must be JSON like {"group-name":"admin"} using the roles viewer, operator, admin.');
      }
    }
    // Unset means "none" (fail closed), never a role.
    const rawDefault = get('DEFAULT_ROLE') || 'none';
    /** @type {Role | null} */
    let defaultRole = null;
    if (rawDefault === 'none') defaultRole = null;
    else if (ROLES.includes(/** @type {Role} */ (rawDefault))) defaultRole = /** @type {Role} */ (rawDefault);
    else problems.push('DEFAULT_ROLE must be viewer, operator, admin or none.');
    if (defaultRole === null && Object.keys(roleMap).length === 0 && !problems.length) {
      warnings.push('ROLE_MAP is empty and DEFAULT_ROLE is none, so nobody can sign in yet. ' +
        'Set ROLE_MAP to map your IdP groups to roles.');
    }

    // The session cookie is signed with this. Short or copied-from-a-README
    // values let anyone forge one.
    sessionSecret = get('SESSION_SECRET');
    const weak = sessionSecret.length < MIN_SECRET_LENGTH || KNOWN_DEFAULT_SECRETS.has(sessionSecret.toLowerCase());
    if (weak && production) {
      problems.push(`SESSION_SECRET must be set to a random value of at least ${MIN_SECRET_LENGTH} characters ` +
        '(openssl rand -hex 32), not a default.');
    } else if (weak) {
      sessionSecret = randomBytes(32).toString('hex');
      warnings.push('SESSION_SECRET is missing or weak, so a random one is used for this run. ' +
        'Sessions end when the server restarts. Production refuses to start like this.');
    }

    const optionalUrl = (/** @type {string} */ name) => {
      const v = get(name);
      return v && url(name, v) ? v : undefined;
    };

    if (issuer && clientId && clientSecret && redirectUri) {
      oidc = {
        issuer,
        clientId,
        clientSecret,
        redirectUri,
        postLogoutRedirectUri: optionalUrl('OIDC_POST_LOGOUT_REDIRECT_URI') || `${redirectUri.origin}/`,
        logoutUrl: optionalUrl('OIDC_LOGOUT_URL'),
        passkeyUrl: optionalUrl('OIDC_PASSKEY_URL'),
        scopes: get('OIDC_SCOPES') || 'openid profile email',
        roleMap,
        defaultRole,
        allowHttp: !production && issuer.protocol === 'http:',
      };
    }
  } else if (production && !allowNoAuth) {
    const hint = ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'].some((n) => get(n))
      ? ' OIDC settings ARE present, so the OIDC_ENABLED flag itself was probably lost from the environment.'
      : '';
    problems.push('Sign-in is off (OIDC_ENABLED is not "true") and NODE_ENV=production. Refusing to start ' +
      'an open server. Set OIDC_ENABLED=true and its settings, or set ALLOW_NO_AUTH=true if this deployment ' +
      `is meant to be public.${hint}`);
  } else if (production) {
    warnings.push('ALLOW_NO_AUTH=true: running in production WITHOUT sign-in. Everyone gets the demo user. ' +
      'Only do this for a public demo with nothing to protect.');
  }

  if (problems.length) throw new ConfigError(problems);
  return { production, port, auth: oidc ? 'oidc' : 'off', oidc, sessionSecret, warnings };
}
