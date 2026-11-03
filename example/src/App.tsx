// Two places: '/' (the farm map) and '/s/<token>' (a share viewer).
//
// Once the map has been visited it stays mounted. When you open a share link
// from the map, the share page draws over it as a fixed full-screen layer
// (z 1500) and the map underneath goes inert + aria-hidden. Coming back keeps
// the map's position, zoom and layers. If you returned <ShareViewer/> instead
// of the map tree, Leaflet would unmount and reset on every trip.

import { useEffect, useState } from 'react';
import { MapPage } from './MapPage';
import { ShareViewer } from './share/ShareViewer';
import { navigate, useLocation } from './lib/router';

export function App() {
  const { pathname, search } = useLocation();
  const onMap = pathname === '/';
  const shareToken = pathname.match(/^\/s\/([A-Za-z0-9_-]{1,64})\/?$/)?.[1];

  // "Adjust state during render" (no effect): mount the map on first visit,
  // and remember the map's own query string while another page is on top.
  const [mapMounted, setMapMounted] = useState(onMap);
  const [mapSearch, setMapSearch] = useState(onMap ? search : '');
  if (onMap && !mapMounted) setMapMounted(true);
  if (onMap && search !== mapSearch) setMapSearch(search);

  useEffect(() => {
    if (onMap) document.title = 'Demo Farm Map';
  }, [onMap]);

  return (
    <>
      {mapMounted && (
        <div className="page" data-page inert={!onMap} aria-hidden={!onMap || undefined}>
          <MapPage search={mapSearch} />
        </div>
      )}
      {shareToken && <ShareViewer key={shareToken} token={shareToken} />}
      {!onMap && !shareToken && (
        <div className="page share-page" data-page>
          <div className="center-card" role="alert">
            <h2>Page not found</h2>
            <button type="button" className="btn-primary" onClick={() => navigate('/')}>Go to the map</button>
          </div>
        </div>
      )}
    </>
  );
}
