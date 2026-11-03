// A slide-out drawer from the left. Two fixed elements that are always in
// the DOM: a backdrop (z 1390) that fades and closes on tap, and the panel
// (z 1400) that slides with transform. Same drawer on phone and desktop.

import { useEffect, useRef } from 'react';
import { LEGENDS, type ColorMode } from '../data/demoFarm';
import type { LayerKey } from '../lib/layersUrl';
import { TILE_CREDIT } from '../lib/tiles';
import { CloseIcon } from './icons';

type Props = {
  open: boolean;
  onClose: () => void;
  layers: Set<LayerKey>;
  onToggle: (k: LayerKey) => void;
  mode: ColorMode;
  onMode: (m: ColorMode) => void;
};

const LAYERS: { key: LayerKey; title: string; hint: string; color: string }[] = [
  { key: 'fields', title: 'Fields', hint: 'Field boundaries, coloured by the mode below', color: '#16a34a' },
  { key: 'labels', title: 'Field labels', hint: 'Placed so they never overlap', color: '#818cf8' },
  { key: 'equipment', title: 'Equipment', hint: 'Last known machine positions', color: '#0e7490' },
  { key: 'grid', title: 'Half-mile grid', hint: 'Outline-only reference layer', color: '#64748b' },
];

/** A switch whose accent bar matches the layer's colour on the map. */
function LayerToggle({ on, title, hint, color, onClick }: { on: boolean; title: string; hint: string; color: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="layer-toggle" onClick={onClick}>
      <span className="lt-accent" style={{ background: color, opacity: on ? 1 : 0.35 }} />
      <span className="lt-text"><b>{title}</b><small>{hint}</small></span>
      <span className="lt-track" style={{ background: on ? color : '#475569' }}>
        <span className="lt-knob" style={{ left: on ? '1.125rem' : '.125rem' }} />
      </span>
    </button>
  );
}

export function LayersDrawer({ open, onClose, layers, onToggle, mode, onMode }: Props) {
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const fieldsOn = layers.has('fields');

  return (
    <>
      <div className={`drawer-backdrop${open ? ' open' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-label="Map layers" aria-hidden={!open} inert={!open}
        className={`drawer drawer-left${open ? ' open' : ''}`}>
        <div className="drawer-head">
          <h2>Map layers</h2>
          <button ref={closeBtn} type="button" className="icon-btn" onClick={onClose} aria-label="Close layers"><CloseIcon /></button>
        </div>
        <div className="drawer-body">
          <section>
            <h3 className="section-title">Layers</h3>
            <div className="stack">
              {LAYERS.map((l) => (
                <LayerToggle key={l.key} on={layers.has(l.key)} title={l.title} hint={l.hint} color={l.color} onClick={() => onToggle(l.key)} />
              ))}
            </div>
          </section>

          <section>
            <h3 className="section-title">Colour fields by</h3>
            {!fieldsOn && <p className="muted">Turn on Fields to use colour modes.</p>}
            <div className="stack" role="radiogroup" aria-label="Colour fields by">
              {(Object.keys(LEGENDS) as ColorMode[]).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={!fieldsOn}
                  className={`mode-btn${mode === m ? ' on' : ''}`} onClick={() => onMode(m)}>
                  <span className="mode-dots">
                    {LEGENDS[m].items.map((i) => <span key={i.key} style={{ background: i.color }} />)}
                  </span>
                  {LEGENDS[m].title}
                </button>
              ))}
            </div>
          </section>

          <p className="muted small">All data on this map is invented for the demo. Basemap: {TILE_CREDIT}.</p>
        </div>
      </aside>
    </>
  );
}
