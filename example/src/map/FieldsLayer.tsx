// One component per overlay. It draws with plain Leaflet on the map from
// useMap(), builds once per dataset, restyles in place, and cleans up on
// unmount. (react-leaflet's <GeoJSON data> only reads `data` once, so either
// do this or give <GeoJSON> a key that changes with the data.)

import L from 'leaflet';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import type { Feature } from 'geojson';
import { fieldColor, type ColorMode, type FieldCollection, type FieldProps } from '../data/demoFarm';

type Props = {
  data: FieldCollection;
  mode: ColorMode;
  selected: string | null;
  onFieldClick: (p: FieldProps, at: L.LatLng) => void;
};

export function FieldsLayer({ data, mode, selected, onFieldClick }: Props) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);
  const styleRef = useRef<(f?: Feature) => L.PathOptions>(() => ({}));
  // Latest-callback ref: the Leaflet layer is built once, but always calls
  // the current handler.
  const clickRef = useRef(onFieldClick);
  useLayoutEffect(() => { clickRef.current = onFieldClick; });

  // Restyle in place when the colour mode or the selection changes.
  // (Declared first so the build effect below starts with the right style.)
  useEffect(() => {
    styleRef.current = (f?: Feature) => {
      const p = f?.properties as FieldProps;
      const color = fieldColor(p, mode);
      const isSel = p.id === selected;
      return {
        color: isSel ? '#0f172a' : '#1e293b',
        weight: isSel ? 4 : 1.5,
        fillColor: color,
        fillOpacity: isSel ? 0.65 : 0.45,
      };
    };
    layerRef.current?.setStyle(styleRef.current);
  }, [mode, selected]);

  useEffect(() => {
    // GeoJSON options are passed on to each polygon, so Polyline options work
    // here too. Leaflet simplifies shapes per zoom (smoothFactor 1); lower
    // keeps the pivot circle round when zoomed out.
    const options: L.GeoJSONOptions & L.PolylineOptions = {
      smoothFactor: 0.3,
      style: (f) => styleRef.current(f),
      onEachFeature: (f, l) =>
        l.on('click', (e: L.LeafletMouseEvent) => clickRef.current(f.properties as FieldProps, e.latlng)),
    };
    const layer = L.geoJSON(data, options).addTo(map);
    layerRef.current = layer;
    return () => {
      layer.remove();
      layerRef.current = null;
    };
  }, [map, data]);

  return null;
}

/** Reference layers are outline-only and non-interactive, so they never hide
 *  or swallow taps meant for the layers underneath. */
export function OutlineLayer({ data, color = '#334155' }: { data: GeoJSON.FeatureCollection; color?: string }) {
  const map = useMap();
  useEffect(() => {
    const layer = L.geoJSON(data, {
      interactive: false,
      style: { color, weight: 1.5, opacity: 0.8, dashArray: '6 6', fill: false },
    }).addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, data, color]);
  return null;
}
