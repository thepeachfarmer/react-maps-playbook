// The main map page: a full-bleed map with chrome floating over it.
//
//   .map-wrap  (fixed, inset 0, isolation: isolate -> Leaflet's z-indexes
//               up to 1000 are caged in here and can't fight the app)
//   TopBar     z 1000   data-chrome="top"
//   TotalsChip z 1000   data-chrome="top"
//   Legend     z 1000   data-chrome="corner"
//   ListPanel  z 1000   data-chrome="right" | "bottom"
//   Drawer     z 1390 / 1400
//   (portals)  modal 2000, toast 3000, user menu 9998 / 9999

import L from 'leaflet';
import { useCallback, useMemo, useState } from 'react';
import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet';
import { FIELDS, GRID, MACHINES, ORIGIN, totals as getTotals, type ColorMode, type FieldProps, type Machine } from './data/demoFarm';
import { FieldsLayer, OutlineLayer } from './map/FieldsLayer';
import { EquipmentLayer } from './map/EquipmentLayer';
import { LabelsLayer } from './map/LabelsLayer';
import { FitToBounds, InvalidateOnResize } from './map/helpers';
import { openFieldPopup, openMachinePopup } from './map/popups';
import { fitPadding } from './lib/chrome';
import { TILE_ATTRIBUTION, TILE_URL } from './lib/tiles';
import { parseView, viewHref, type LayerKey } from './lib/layersUrl';
import { PANEL_QUERY, navigate, useMediaQuery } from './lib/router';
import { TopBar } from './ui/TopBar';
import { UserMenu } from './ui/UserMenu';
import { LayersDrawer } from './ui/LayersDrawer';
import { Legend } from './ui/Legend';
import { TotalsChip } from './ui/TotalsChip';
import { ListPanel } from './ui/ListPanel';
import { LayersIcon, ListIcon } from './ui/icons';

const FARM_BOUNDS = L.geoJSON(FIELDS).getBounds();
const TOTALS = getTotals(FIELDS);

export function MapPage({ search }: { search: string }) {
  const { layers, mode } = useMemo(() => parseView(search), [search]);
  const side = useMediaQuery(PANEL_QUERY);
  const [map, setMap] = useState<L.Map | null>(null);
  const [drawer, setDrawer] = useState(false);
  // Open beside the map on a desktop; closed on phones (incl. landscape).
  const [listOpen, setListOpen] = useState(() => matchMedia('(min-width: 768px) and (min-height: 501px)').matches);
  const [selected, setSelected] = useState<string | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  // One canvas renderer per map; tolerance makes thin lines finger-tappable.
  const renderer = useMemo(() => L.canvas({ tolerance: 8 }), []);

  const setView = (nextLayers: Set<LayerKey>, nextMode: ColorMode) =>
    navigate(viewHref(nextLayers, nextMode), { replace: true });
  const toggleLayer = (k: LayerKey) => {
    const next = new Set(layers);
    if (next.has(k)) next.delete(k); else next.add(k);
    setView(next, mode);
  };

  // Track the selection from popups: whichever popup closes clears it.
  const mapRef = useCallback((m: L.Map | null) => {
    setMap(m);
    m?.on('popupclose', () => setSelected(null));
  }, []);

  const onFieldClick = useCallback((p: FieldProps, at?: L.LatLngExpression) => {
    if (!map) return;
    openFieldPopup(map, p, mode, at);
    setSelected(p.id);
  }, [map, mode]);

  const onMachine = useCallback((m: Machine) => {
    if (map) openMachinePopup(map, m);
  }, [map]);

  // Tapping a row: on a phone, fold the sheet first so the zoom and the popup
  // use the space the user will actually see.
  const afterSheet = (fn: () => void) => {
    if (!side && listOpen) {
      setListOpen(false);
      requestAnimationFrame(() => requestAnimationFrame(fn));
    } else fn();
  };
  const pickField = (p: FieldProps) => afterSheet(() => {
    if (!map) return;
    const f = FIELDS.features.find((x) => x.properties.id === p.id);
    if (!f) return;
    map.once('moveend', () => onFieldClick(p));
    map.fitBounds(L.geoJSON(f).getBounds(), { ...fitPadding(map), maxZoom: 16 });
  });
  const pickMachine = (m: Machine) => afterSheet(() => {
    if (!map) return;
    map.once('moveend', () => onMachine(m));
    map.setView([m.lat, m.lng], Math.max(map.getZoom(), 16));
  });

  const closeDrawer = useCallback(() => setDrawer(false), []);
  const showFields = layers.has('fields');
  const showEquip = layers.has('equipment');
  const pins = useMemo(() => (showEquip ? MACHINES : []), [showEquip]);

  return (
    <>
      <div className="map-wrap">
        <MapContainer ref={mapRef} center={[ORIGIN.lat, ORIGIN.lng]} zoom={14} zoomControl={false}
          zoomSnap={0.25} zoomDelta={0.5} renderer={renderer} className="map" attributionControl>
          <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />
          <ZoomControl position="bottomright" />
          <InvalidateOnResize />
          <FitToBounds bounds={FARM_BOUNDS} nonce={fitNonce} />
          {layers.has('grid') && <OutlineLayer data={GRID} />}
          {showFields && <FieldsLayer data={FIELDS} mode={mode} selected={selected} onFieldClick={onFieldClick} />}
          {showEquip && <EquipmentLayer machines={MACHINES} onOpen={onMachine} />}
          {showFields && layers.has('labels') && <LabelsLayer fields={FIELDS} pins={pins} />}
        </MapContainer>
      </div>

      <TopBar
        title="Demo Farm Map"
        homeLabel="Zoom to the whole farm"
        onHome={() => setFitNonce((n) => n + 1)}
        right={<UserMenu />}
        tools={
          <button type="button" className="tool-btn" onClick={() => setDrawer(true)} aria-haspopup="dialog">
            <LayersIcon /><span>Layers</span>
          </button>
        }
        toolsEnd={
          <button type="button" className="tool-btn end" onClick={() => setListOpen(!listOpen)} aria-pressed={listOpen}>
            <ListIcon /><span>Fields</span>
          </button>
        }
      />

      <TotalsChip done={TOTALS.done} acres={TOTALS.acres} fields={TOTALS.fields} left={TOTALS.left}
        machines={MACHINES.length} onClick={() => setListOpen(true)} />

      <Legend mode={mode} showFields={showFields} showEquipment={showEquip} />

      <ListPanel side={side} open={listOpen} setOpen={setListOpen} fields={FIELDS}
        machines={showEquip ? MACHINES : null} mode={mode} selected={selected} totals={TOTALS}
        onPickField={pickField} onPickMachine={pickMachine} />

      <LayersDrawer open={drawer} onClose={closeDrawer}
        layers={layers} onToggle={toggleLayer} mode={mode} onMode={(m) => setView(layers, m)} />
    </>
  );
}
