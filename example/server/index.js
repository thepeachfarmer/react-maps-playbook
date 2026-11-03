// @ts-check
// An optional, small Node server for the demo map. It serves the built app
// (dist/) with the same caching rules as nginx.conf, and adds sign-in when
// OIDC_ENABLED=true. With sign-in off it behaves like the static demo.
//
//   npm run build && npm start                    demo user, http://localhost:3000
//   docker build --target server -t react-maps-example:server .
//
// What is public and what needs a session (when sign-in is on):
//   public   /health, /api/auth/*, built files (/assets, /icon.svg ...),
//            /s/<token> share pages and /shares/* share data (docs/05)
//   session  the app shell (/ and other pages) and every other /api/* route
//
// In this demo the field data is inside the JavaScript bundle, so the gate is
// a demonstration. In a real app the data comes from /api/*, and that is what
// the session protects.
//
// Mount order matters: health, static files, share pages, then the session,
// the auth routes, the gate, and finally the app shell.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import { ConfigError, loadConfig } from './config.js';
import { SESSION_COOKIE, authRouter, requireSignedIn } from './auth.js';

// 1. Configuration first. A bad config stops the process here, before it
//    listens on a port, so the container crash-loops where you'll notice it.
let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  for (const p of err.problems) console.error(`FATAL: ${p}`);
  console.error('FATAL: refusing to start. See example/README.md, "Optional sign-in".');
  process.exit(1);
}
for (const w of cfg.warnings) console.warn(`WARNING: ${w}`);

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
let shell;
try {
  shell = readFileSync(path.join(DIST, 'index.html'), 'utf8');
} catch {
  console.error(`FATAL: ${DIST}/index.html not found. Run "npm run build" first.`);
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
// Behind Caddy (one proxy hop): believe its X-Forwarded-Proto, so req.secure
// is true and the Secure session cookie is actually sent. Without this you
// get a silent sign-in loop (docs/07).
app.set('trust proxy', 1);

// 2. Health: no auth, never cached. "auth" lets an outside check confirm
//    that sign-in is really on after a deploy (docs/14).
app.get('/health', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ status: 'ok', auth: cfg.auth });
});

// 3. Built files. Same rules as nginx.conf: hashed bundles cached for a year,
//    share data always revalidated and kept out of search engines.
//    index.html is NOT served from here; it goes through the gate below.
app.get('/index.html', (_req, res) => res.redirect(301, '/'));
app.use(express.static(DIST, {
  index: false,
  redirect: false,
  setHeaders(res, filePath) {
    const rel = path.relative(DIST, filePath).split(path.sep).join('/');
    if (rel.startsWith('assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (rel.startsWith('shares/')) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));
// A missing bundle or share file is a 404, never the app shell.
app.use(['/assets', '/shares'], (_req, res) => {
  res.status(404).type('text').send('Not found');
});

/** @type {express.RequestHandler} */
const sendShell = (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  res.set('Cache-Control', 'no-cache').type('html').send(shell);
};

// 4. Share pages are public: someone outside the company opens them without
//    an account (docs/05).
app.use('/s', (req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  sendShell(req, res, next);
});

// 5. Sessions (only when sign-in is on). An HttpOnly cookie holding a random
//    id; the user lives on the server. MemoryStore is fine for this demo and
//    a single container. A real app uses connect-redis or connect-pg-simple,
//    so sessions survive a restart and back-channel logout can find them.
if (cfg.oidc) {
  app.use(session({
    name: SESSION_COOKIE,
    secret: cfg.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',          // sent on the redirect back from the IdP; not on cross-site POSTs
      secure: cfg.production ? true : 'auto',
      maxAge: 8 * 60 * 60 * 1000,
    },
  }));
}

app.use('/api/auth', authRouter(cfg));
if (cfg.oidc) app.use(requireSignedIn);

// 6. Everything else. Unknown API routes are JSON 404s; any other GET is
//    the app shell, so client-side routes work on refresh.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found' });
});
app.use(sendShell);

// Four arguments is how Express recognises an error handler. Log the message
// only: a stack trace or request dump could hold a token.
app.use(
  /**
   * @param {unknown} err
   * @param {express.Request} _req
   * @param {express.Response} res
   * @param {express.NextFunction} _next
   */
  (err, _req, res, _next) => {
    console.error(`[server] ${err instanceof Error ? err.message : err}`);
    if (!res.headersSent) res.status(500).type('text').send('Something went wrong.');
  },
);

app.listen(cfg.port, () => {
  const mode = cfg.oidc ? `sign-in ON via ${cfg.oidc.issuer.origin}` : 'sign-in OFF (demo user)';
  console.log(`[server] ${cfg.production ? 'production' : 'development'}, ${mode}, port ${cfg.port}`);
});
