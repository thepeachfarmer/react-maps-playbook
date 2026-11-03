// "Chrome" = the fixed UI that floats over the map: the top bar, the totals
// chip, the legend, the list panel. Each of those elements carries
// data-chrome="top|bottom|left|right" (the edge of the map it eats into).
//
// Everything that must stay clear of the chrome asks this module:
//   - popups  -> autoPan padding + maxHeight      (popupOptions)
//   - fits    -> paddingTopLeft / BottomRight     (fitPadding)
//   - labels  -> obstacles for greedy placement   (chromeRects)
// so nothing hard-codes "the bar is 96px tall".

import L from 'leaflet';
import { useLayoutEffect, type RefObject } from 'react';

// 'corner' = a small element in a corner (the legend): labels and popups
// avoid it, but a fit ignores it so the data isn't squeezed into a strip.
export type Edge = 'top' | 'bottom' | 'left' | 'right' | 'corner';
export type Rect = [number, number, number, number]; // left, top, right, bottom

export const CHROME_EVENT = 'chrome:change';

/** The page that owns this map (a page kept mounted underneath has its own chrome). */
function pageOf(map: L.Map): ParentNode {
  return map.getContainer().closest('[data-page]') ?? document;
}

/** Rectangles of visible chrome, in the map container's pixel coordinates. */
export function chromeRects(map: L.Map, includeLeafletControls = false): { edge: Edge; rect: Rect }[] {
  const box = map.getContainer().getBoundingClientRect();
  const out: { edge: Edge; rect: Rect }[] = [];
  const add = (el: Element, edge: Edge) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    out.push({ edge, rect: [r.left - box.left, r.top - box.top, r.right - box.left, r.bottom - box.top] });
  };
  pageOf(map).querySelectorAll<HTMLElement>('[data-chrome]').forEach((el) => add(el, el.dataset.chrome as Edge));
  if (includeLeafletControls) map.getContainer().querySelectorAll('.leaflet-control').forEach((el) => add(el, 'bottom'));
  return out;
}

/** How far each edge of the map is covered by chrome, plus a gap. */
export function chromeInsets(map: L.Map, gap = 10, corners = true) {
  const size = map.getSize();
  let top = 0, bottom = 0, left = 0, right = 0;
  for (const { edge, rect: [l, t, r, b] } of chromeRects(map)) {
    // Ignore anything parked off-screen (a closed side panel is translated out).
    if (r <= 0 || l >= size.x || b <= 0 || t >= size.y) continue;
    if (edge === 'corner' && !corners) continue;
    if (edge === 'top') top = Math.max(top, b);
    else if (edge === 'bottom' || edge === 'corner') bottom = Math.max(bottom, size.y - t);
    else if (edge === 'right') right = Math.max(right, size.x - l);
    else left = Math.max(left, r);
  }
  return { top: top + gap, bottom: bottom + gap, left: left + gap, right: right + gap };
}

export function fitPadding(map: L.Map): Pick<L.FitBoundsOptions, 'paddingTopLeft' | 'paddingBottomRight'> {
  const i = chromeInsets(map, 16, false);
  return { paddingTopLeft: [i.left, i.top], paddingBottomRight: [i.right, i.bottom] };
}

/**
 * Popup options built at the moment a popup opens, so they reflect whatever
 * is on screen right now (an open list, a folded legend, a rotated phone).
 */
export function popupOptions(map: L.Map, extra: L.PopupOptions = {}): L.PopupOptions {
  const i = chromeInsets(map);
  const size = map.getSize();
  const short = size.y < 500; // landscape phone: go wide, not tall
  const roomW = size.x - i.left - i.right;
  return {
    maxWidth: Math.max(180, Math.min(short ? 420 : 280, roomW - 24)),
    maxHeight: Math.max(120, size.y - i.top - i.bottom - 40),
    autoPanPaddingTopLeft: L.point(i.left, i.top),
    autoPanPaddingBottomRight: L.point(i.right, i.bottom),
    className: 'app-popup',
    ...extra,
  };
}

/**
 * Measure an element with a ResizeObserver and publish the number as a CSS
 * variable on its page root (e.g. --bar-h). Other chrome positions itself
 * with calc(var(--bar-h) + 6px) instead of a hard-coded offset, and the map
 * layers hear CHROME_EVENT and re-place labels.
 */
export function useMeasuredVar(
  ref: RefObject<HTMLElement | null>,
  name: string,
  measure: (el: HTMLElement) => number,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = (el.closest('[data-page]') as HTMLElement | null) ?? document.documentElement;
    const apply = () => {
      root.style.setProperty(name, `${Math.round(measure(el))}px`);
      window.dispatchEvent(new Event(CHROME_EVENT));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, name, measure]);
}

export const measureBottom = (el: HTMLElement) => el.getBoundingClientRect().bottom;
export const measureHeight = (el: HTMLElement) => el.getBoundingClientRect().height;
