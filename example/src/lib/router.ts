// A router small enough to read in one sitting. No library.
//  - navigate() pushes a history entry and fires 'app:navigate'
//  - useLocation() re-renders on that event and on popstate (Back/Forward)
//  - goBackOr() uses history.back() when we know the previous entry is the
//    page we want, so Android Back doesn't replay every trip.

import { useMemo, useSyncExternalStore } from 'react';

const EVT = 'app:navigate';
const here = () => location.pathname + location.search + location.hash;

export function navigate(href: string, opts: { replace?: boolean } = {}) {
  if (href === here()) return;
  if (opts.replace) history.replaceState(history.state, '', href);
  else history.pushState({ from: location.pathname }, '', href);
  window.dispatchEvent(new Event(EVT));
}

/** Go back to `path` if that's where we came from; otherwise navigate there. */
export function goBackOr(path: string) {
  if (history.state?.from === path) history.back();
  else navigate(path);
}

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(EVT, cb);
  };
}

export function useLocation() {
  const href = useSyncExternalStore(subscribe, here);
  return useMemo(() => {
    const u = new URL(href, location.origin);
    return { pathname: u.pathname, search: u.search };
  }, [href]);
}

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => matchMedia(query).matches,
  );
}

/**
 * One media query decides "side panel" vs "bottom sheet". Use the same string
 * in CSS (see styles.css) so the two can never disagree.
 */
export const PANEL_QUERY = '(min-width: 768px), (orientation: landscape) and (max-height: 500px)';
export const SHORT_LANDSCAPE = '(orientation: landscape) and (max-height: 500px)';
