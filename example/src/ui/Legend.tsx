// A floating legend. It's a <details> element: open by default on wide
// screens, folded on phones so it doesn't eat the map. It carries
// data-chrome="corner", so popups and labels keep clear of it, and it is
// measured, so opening or folding it re-places the labels.

import { useRef, useState } from 'react';
import { LEGENDS, type ColorMode } from '../data/demoFarm';
import { KIND_LABEL, equipmentSvg, type EquipmentKind } from '../map/equipmentIcons';
import { measureHeight, useMeasuredVar } from '../lib/chrome';

export function Legend({ mode, showFields, showEquipment }: { mode: ColorMode; showFields: boolean; showEquipment: boolean }) {
  const [open, setOpen] = useState(() => matchMedia('(min-width: 700px) and (min-height: 501px)').matches);
  const ref = useRef<HTMLDetailsElement>(null);
  useMeasuredVar(ref, '--legend-h', measureHeight);
  const legend = LEGENDS[mode];

  return (
    <details ref={ref} className="legend" data-chrome="corner" open={open} hidden={!showFields && !showEquipment}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Legend</summary>
      <div className="legend-body">
        {showFields && (
          <>
            <div className="legend-title">{legend.title}</div>
            <ul>
              {legend.items.map((i) => (
                <li key={i.key}><span className="swatch" style={{ background: i.color }} />{i.label}</li>
              ))}
            </ul>
          </>
        )}
        {showEquipment && (
          <>
            <div className="legend-title">Equipment</div>
            <ul className="legend-equip">
              {(Object.keys(KIND_LABEL) as EquipmentKind[]).map((k) => (
                <li key={k}>
                  <span className="legend-icon" dangerouslySetInnerHTML={{ __html: equipmentSvg(k, 28, 21) }} />
                  {KIND_LABEL[k]}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}
