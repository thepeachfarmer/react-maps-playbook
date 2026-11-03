/**
 * "Clear cache & reload". Unregister service workers, delete Cache Storage,
 * clear local/session storage (cookies stay, so a real app stays signed in),
 * then navigate with a cache-busting query. A plain location.reload() can be
 * answered from cache, which is exactly what you're trying to escape.
 */
export async function hardReset() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    for (const r of regs) await r.unregister();
  } catch { /* not available (e.g. plain http) */ }
  try {
    for (const k of await caches.keys()) await caches.delete(k);
  } catch { /* caches is undefined outside a secure context */ }
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch { /* storage blocked */ }
  await new Promise((r) => setTimeout(r, 100));
  const u = new URL(location.href);
  u.searchParams.set('_hardReset', String(Date.now()));
  u.hash = '';
  location.replace(u.toString());
}

/** Drop the cache-busting param again once we've booted. */
export function stripHardResetParam() {
  const u = new URL(location.href);
  if (!u.searchParams.has('_hardReset')) return;
  u.searchParams.delete('_hardReset');
  history.replaceState(history.state, '', u.pathname + u.search + u.hash);
}
