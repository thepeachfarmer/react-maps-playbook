// The top-right user menu.
//
// THE RULE: the open menu is rendered with createPortal into document.body,
// over a transparent click-trap backdrop (z 9998) with the menu at z 9999.
// Raising z-index in place does not work: the top bar uses backdrop-filter,
// which (like transform, filter, will-change, or position + z-index) creates
// a stacking context, and a child can never rise above its stacking context.
// Only a portal escapes it. A backdrop (not a document 'pointerdown'
// listener) also stops the closing tap from falling through to the map.
//
// Who is signed in comes from src/lib/auth.ts. With no server (npm run dev,
// the nginx image) or the server's sign-in off, that's the made-up demo user.
// With example/server and OIDC_ENABLED=true, it's the real user, "Sign out"
// ends the identity provider's session too, and "Add a passkey" appears when
// the server knows the IdP's passkey page.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { navigate } from '../lib/router';
import { hardReset } from '../lib/hardReset';
import { signOut, useAuth } from '../lib/auth';
import { InfoIcon, KeyIcon, LinkIcon, LogoutIcon, RefreshIcon } from './icons';
import { AboutDialog } from './AboutDialog';
import { useToast } from './Toast';

export const DEMO_SHARE_TOKEN = 'demo-7k2m9q4x8p';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'U';

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const [about, setAbout] = useState(false);
  const [pos, setPos] = useState({ top: 56, right: 12 });
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const auth = useAuth();
  const user = auth.status === 'loading' ? null : auth.user;
  const close = useCallback(() => setOpen(false), []);

  // Position from the trigger; recompute on resize and on any scroll.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (r) setPos({ top: Math.round(r.bottom + 8), right: Math.max(8, Math.round(innerWidth - r.right)) });
    };
    place();
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    return () => {
      removeEventListener('resize', place);
      removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Escape closes; focus the first item on open, return focus on close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const trigger = btn.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      trigger?.focus();
    };
  }, [open]);

  const item = (label: string, icon: ReactNode, onClick: () => void, danger = false) => (
    <button type="button" role="menuitem" className={`menu-item${danger ? ' danger' : ''}`}
      onClick={() => { close(); onClick(); }}>
      {icon}<span>{label}</span>
    </button>
  );

  return (
    <>
      <button ref={btn} type="button" className="user-pill" onClick={() => setOpen((v) => !v)}
        disabled={!user} aria-haspopup="menu" aria-expanded={open}
        aria-label={user ? `Account: ${user.name}` : 'Account: loading'}>
        <span className="avatar">{user ? initials(user.name) : '…'}</span>
        {user && <span className="user-name">{user.name}</span>}
        {user && <span className="role-chip">{user.role}</span>}
      </button>

      {open && user && createPortal(
        <>
          <div className="menu-backdrop" onClick={close} aria-hidden="true" />
          <div ref={menu} role="menu" aria-label="Account" className="menu" style={{ top: pos.top, right: pos.right }}>
            <div className="menu-id">
              <span className="avatar avatar-lg">{initials(user.name)}</span>
              <div className="menu-id-text">
                <strong>{user.name} <span className="role-badge">{user.role}</span></strong>
                <span>{user.email}</span>
              </div>
            </div>
            {item('Open the sample share link', <LinkIcon />, () => navigate(`/s/${DEMO_SHARE_TOKEN}`))}
            {item('About this demo', <InfoIcon />, () => setAbout(true))}
            {auth.status === 'signed-in' && auth.passkeyUrl
              && item('Add a passkey', <KeyIcon />, () => window.open(auth.passkeyUrl, '_blank', 'noopener'))}
            {item('Clear cache & reload', <RefreshIcon />, () => void hardReset())}
            {item('Sign out', <LogoutIcon />, () => {
              void signOut().then((real) => { if (!real) toast('This demo has no real sign-in.'); });
            }, true)}
          </div>
        </>,
        document.body,
      )}

      {about && <AboutDialog onClose={() => setAbout(false)} />}
    </>
  );
}
