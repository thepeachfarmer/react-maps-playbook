// Who is signed in, as far as the UI is concerned.
//
// The server decides (example/server, docs/14). This file only asks it:
//   GET /api/auth/me -> 200 {mode:'oidc', user}   signed in
//                    -> 200 {mode:'demo', user}   the server runs with sign-in off
//                    -> 401                       signed out: go to the IdP
//   no server at all (npm run dev, the nginx image) -> the made-up demo user
//
// The role is for showing and hiding buttons only. The server checks it on
// every request that matters; never trust it here (docs/07).

import { useSyncExternalStore } from 'react';

export type Role = 'viewer' | 'operator' | 'admin';
export type User = { name: string; email: string; role: Role };
export type Auth =
  | { status: 'loading' }
  | { status: 'demo'; user: User }
  | { status: 'signed-in'; user: User; passkeyUrl?: string };

export const DEMO_USER: User = { name: 'Demo User', email: 'demo.user@example.com', role: 'viewer' };

let state: Auth = { status: 'loading' };
let leaving = false;   // set while the browser is on its way to the IdP
const listeners = new Set<() => void>();
const setState = (next: Auth) => {
  state = next;
  listeners.forEach((l) => l());
};

const isUser = (u: unknown): u is User => {
  const x = u as Partial<User> | null;
  return !!x && typeof x.name === 'string' && typeof x.email === 'string'
    && (x.role === 'viewer' || x.role === 'operator' || x.role === 'admin');
};

/** Off to the IdP, coming back to this exact page. */
export function signIn() {
  if (leaving) return;
  leaving = true;
  location.assign(`/api/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`);
}

async function check() {
  if (leaving) return;
  let r: Response;
  try {
    // Accept: application/json matters. Without it, Vite's dev server answers
    // an unknown path with index.html and a 200.
    r = await fetch('/api/auth/me', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch {
    // Offline or no server. Keep a real user if we had one.
    if (state.status === 'loading') setState({ status: 'demo', user: DEMO_USER });
    return;
  }
  if (r.status === 401) return signIn();   // ONLY a 401 means "signed out"

  const json = r.ok && r.headers.get('content-type')?.includes('application/json')
    ? await r.json().catch(() => null) : null;
  if (json?.mode === 'oidc' && isUser(json.user)) {
    const passkey = typeof json.links?.passkey === 'string' ? json.links.passkey : undefined;
    setState({ status: 'signed-in', user: json.user, passkeyUrl: passkey });
  } else if (state.status !== 'signed-in') {
    setState({ status: 'demo', user: isUser(json?.user) ? json.user : DEMO_USER });
  }
}

let started = false;
function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!started) {
    started = true;
    void check();
    // Signed out in another tab, or the session expired while the phone was
    // in a pocket: find out as soon as the app is looked at again.
    const recheck = () => {
      if (state.status === 'signed-in' && document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
  }
  return () => {
    listeners.delete(cb);
  };
}

export function useAuth(): Auth {
  return useSyncExternalStore(subscribe, () => state);
}

/**
 * Sign out of the app AND the identity provider. Returns false when there is
 * no real sign-in (demo mode), so the caller can say so.
 */
export async function signOut(): Promise<boolean> {
  if (state.status !== 'signed-in') return false;
  // Don't set a "signed out" state first: the app would see "no user" and
  // start a fresh sign-in before the browser reaches the IdP's logout page.
  leaving = true;
  try {
    const r = await fetch('/api/auth/logout', { method: 'POST', headers: { Accept: 'application/json' } });
    const { logoutUrl } = (await r.json()) as { logoutUrl?: unknown };
    location.assign(typeof logoutUrl === 'string' && logoutUrl ? logoutUrl : '/');
  } catch {
    location.assign('/');
  }
  return true;
}
