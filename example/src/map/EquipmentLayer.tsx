import L from 'leaflet';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import type { Machine } from '../data/demoFarm';
import { equipmentIcon } from './equipmentIcons';

/** Machine positions as custom SVG divIcons (no default PNG pins, no text label). */
export function EquipmentLayer({ machines, onOpen }: { machines: Machine[]; onOpen: (m: Machine) => void }) {
  const map = useMap();
  const openRef = useRef(onOpen);
  useLayoutEffect(() => { openRef.current = onOpen; });

  useEffect(() => {
    const group = L.layerGroup();
    for (const m of machines) {
      L.marker([m.lat, m.lng], { icon: equipmentIcon(m.kind), title: m.name, alt: m.name, riseOnHover: true })
        .on('click', () => openRef.current(m))
        .addTo(group);
    }
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [map, machines]);

  return null;
}
