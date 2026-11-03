// Headless map helpers: tiny children of <MapContainer> that call useMap(),
// do one imperative job and render nothing.

import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { fitPadding } from '../lib/chrome';

/**
 * Leaflet measures its container once. Phones change size late (iOS
 * safe-area and dvh settle a few frames after load, rotation, the keyboard),
 * so re-measure on every container resize.
 */
export function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    let t = 0;
    const go = () => {
      clearTimeout(t);
      t = window.setTimeout(() => map.invalidateSize(), 100);
    };
    const ro = new ResizeObserver(go);
    ro.observe(map.getContainer());
    window.addEventListener('orientationchange', go);
    window.visualViewport?.addEventListener('resize', go);
    go();
    return () => {
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener('orientationchange', go);
      window.visualViewport?.removeEventListener('resize', go);
    };
  }, [map]);
  return null;
}

/**
 * Fit once on mount (no animation, so the first label placement matches the
 * view people actually get), then again only when `nonce` changes, e.g. a
 * "whole farm" button that does setNonce(n => n + 1). Never refit on data
 * refreshes: that yanks the map away from wherever the user panned.
 */
export function FitToBounds({ bounds, nonce = 0, maxZoom = 17 }: { bounds: L.LatLngBounds; nonce?: number; maxZoom?: number }) {
  const map = useMap();
  const done = useRef<number | null>(null);
  useEffect(() => {
    if (!bounds.isValid() || done.current === nonce) return;
    const first = done.current === null;
    done.current = nonce;
    map.fitBounds(bounds, { ...fitPadding(map), maxZoom, animate: !first });
  }, [map, bounds, nonce, maxZoom]);
  return null;
}
