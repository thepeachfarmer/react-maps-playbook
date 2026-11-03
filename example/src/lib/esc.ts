// divIcon html and Leaflet popup strings are set as innerHTML.
// Every interpolated value goes through esc(). (JSX is escaped by React;
// these strings are not.)
const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => MAP[c]);
