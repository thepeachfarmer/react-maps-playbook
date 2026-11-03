// A login-free "share viewer" at /s/<token>.
//
// The token is looked up in a registry that maps unguessable tokens to static
// GeoJSON files. Here the registry is a JSON file in public/ so the demo runs
// without a server. In a real deployment, keep the registry on the server
// (GET /api/share/:token) so nobody can download the list of tokens; the
// token is the only thing protecting the data.
//
// The viewer is driven by feature properties (stroke, stroke_width, dash,
// fill, fill_opacity, group, name, note, layer), so a new map is mostly a new
// GeoJSON file, not new code.

import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { TopBar } from '../ui/TopBar';
import { FitToBounds, InvalidateOnResize } from '../map/helpers';
import { popupOptions } from '../lib/chrome';
import { esc } from '../lib/esc';
import { goBackOr } from '../lib/router';
import { TILE_ATTRIBUTION, TILE_URL } from '../lib/tiles';

type Registry = Record<string, { title: string; file: string }>;
type Props = { layer?: string; group?: string; name?: string; note?: string; label?: string; stroke?: string;
  stroke_width?: number; dash?: string; fill?: string; fill_opacity?: number };
type FC = FeatureCollection<Geometry, Props>;
type State = { s: 'loading' } | { s: 'error'; notFound: boolean } | { s: 'ok'; title: string; fc: FC };

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  return r.json() as Promise<T>;
}

export function ShareViewer({ token }: { token: string }) {
  const [state, setState] = useState<State>({ s: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const reg = await getJson<Registry>('/shares/registry.json');
        // Object.hasOwn, not reg[token]: a plain lookup also "finds" keys
        // like 'constructor' on the prototype.
        const share = Object.hasOwn(reg, token) ? reg[token] : undefined;
        // The file name comes from the registry, never from the URL, and is
        // still checked against a strict pattern.
        if (!share || !/^[a-z0-9-]+\.geojson$/.test(share.file)) {
          if (!cancelled) setState({ s: 'error', notFound: true });
          return;
        }
        const fc = await getJson<FC>(`/shares/${share.file}`);
        if (!cancelled) setState({ s: 'ok', title: share.title, fc });
      } catch (e) {
        if (!cancelled) setState({ s: 'error', notFound: (e as { status?: number }).status === 404 });
      }
    })();
    return () => { cancelled = true; };
  }, [token, attempt]);

  // Share pages should not end up in search results (nginx also sends X-Robots-Tag).
  useEffect(() => {
    const m = document.createElement('meta');
    m.name = 'robots';
    m.content = 'noindex, nofollow';
    document.head.appendChild(m);
    return () => m.remove();
  }, []);

  const title = state.s === 'ok' ? state.title : state.s === 'loading' ? 'Loading…' : 'Shared map';
  useEffect(() => { document.title = `${title} · Demo Farm Map`; }, [title]);

  return (
    <div className="page share-page" data-page>
      {/* The bar goes up before any data arrives, so a slow or failed load
          still has a way home. */}
      <TopBar title={title} homeLabel="Back to the farm map" homeWord="Farm map" onHome={() => goBackOr('/')} />
      {state.s === 'ok' && <ShareMap fc={state.fc} />}
      {state.s === 'loading' && <div className="center-card" role="status">Loading map…</div>}
      {state.s === 'error' && (
        <div className="center-card" role="alert">
          {state.notFound ? (
            <><h2>This link isn’t valid or has expired.</h2><p>Ask whoever sent it for a new one.</p>
              <button type="button" className="btn-primary" onClick={() => goBackOr('/')}>Go to the farm map</button></>
          ) : (
            <><h2>Couldn’t load the map.</h2><p>Check your signal and try again.</p>
              <button type="button" className="btn-primary" onClick={() => { setState({ s: 'loading' }); setAttempt((a) => a + 1); }}>Try again</button></>
          )}
        </div>
      )}
    </div>
  );
}

function ShareMap({ fc }: { fc: FC }) {
  const renderer = useMemo(() => L.canvas({ tolerance: 10 }), []);
  const bounds = useMemo(() => L.geoJSON(fc).getBounds(), [fc]);
  const legend = useMemo(() => legendOf(fc), [fc]);
  return (
    <>
      <div className="map-wrap">
        <MapContainer center={bounds.getCenter()} zoom={15} zoomControl={false} zoomSnap={0.25} renderer={renderer} className="map">
          <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />
          <InvalidateOnResize />
          <FitToBounds bounds={bounds} maxZoom={17} />
          <PlanLayer fc={fc} />
        </MapContainer>
      </div>
      <details className="legend" data-chrome="corner" open={matchMedia('(min-width: 700px) and (min-height: 501px)').matches}>
        <summary>Legend</summary>
        <div className="legend-body">
          <ul>
            {legend.map((i) => (
              <li key={i.label}><span className={`swatch swatch-${i.kind}`} style={{ background: i.color }} />{i.label}</li>
            ))}
          </ul>
        </div>
      </details>
    </>
  );
}

function PlanLayer({ fc }: { fc: FC }) {
  const map = useMap();
  useEffect(() => {
    const open = (f: Feature<Geometry, Props>, at: L.LatLng) => {
      const p = f.properties ?? {};
      if (!p.name) return;
      L.popup(popupOptions(map))
        .setLatLng(at)
        .setContent(`<div class="pop"><div class="pop-title">${esc(p.name)}</div>${p.note ? `<p class="pop-note">${esc(p.note)}</p>` : ''}</div>`)
        .openOn(map);
    };
    const shapes = L.geoJSON(fc, {
      filter: (f) => f.properties?.layer !== 'label',
      style: (f) => {
        const p = (f?.properties ?? {}) as Props;
        if (f?.geometry.type === 'Point') return { color: '#ffffff', weight: 2, fillColor: p.fill ?? '#ef4444', fillOpacity: 1 };
        return {
          color: p.stroke ?? '#334155',
          weight: p.stroke_width ?? 2,
          dashArray: p.dash,
          fill: Boolean(p.fill),
          fillColor: p.fill,
          fillOpacity: p.fill_opacity ?? 0.25,
        };
      },
      pointToLayer: (f, ll) => L.circleMarker(ll, {
        radius: 7, color: '#ffffff', weight: 2, fillColor: f.properties?.fill ?? '#ef4444', fillOpacity: 1,
      }),
      onEachFeature: (f, l) => l.on('click', (e: L.LeafletMouseEvent) => open(f, e.latlng)),
    }).addTo(map);

    // Precomputed label points ('label' features), shown from zoom 14.
    const labels = L.layerGroup();
    for (const f of fc.features) {
      if (f.properties?.layer !== 'label' || f.geometry.type !== 'Point') continue;
      const [lng, lat] = f.geometry.coordinates;
      labels.addLayer(L.marker([lat, lng], {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'map-label', iconSize: [0, 0], html: `<span>${esc(f.properties.label ?? '')}</span>` }),
      }));
    }
    const sync = () => (map.getZoom() >= 14 ? labels.addTo(map) : labels.remove());
    sync();
    map.on('zoomend', sync);
    return () => {
      map.off('zoomend', sync);
      shapes.remove();
      labels.remove();
    };
  }, [map, fc]);
  return null;
}

function legendOf(fc: FC) {
  const seen = new Map<string, { label: string; color: string; kind: 'line' | 'area' | 'point' }>();
  for (const f of fc.features) {
    const p = f.properties ?? {};
    if (p.layer === 'label' || !p.group || seen.has(p.group)) continue;
    const t = f.geometry.type;
    const kind = t.includes('Point') ? 'point' : t.includes('Line') ? 'line' : 'area';
    seen.set(p.group, { label: p.group, color: (kind === 'line' ? p.stroke : p.fill ?? p.stroke) ?? '#334155', kind });
  }
  return [...seen.values()];
}
