// What the server keeps in a session. Type-checked with `tsc -p server`.
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    /** Between /api/auth/login and /api/auth/callback only. */
    login?: { verifier: string; state: string; next: string };
    /** Set after a successful sign-in. */
    user?: {
      sub: string;
      name: string;
      email: string;
      role: 'viewer' | 'operator' | 'admin';
      /** Sent back to the IdP as id_token_hint when signing out. */
      idToken?: string;
    };
  }
}
