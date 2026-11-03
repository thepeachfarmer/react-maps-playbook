// The list beside the map.
//  - side mode (>= 768px wide, or a landscape phone): a panel on the right,
//    from under the bar to the bottom. Open by default on desktop.
//  - bottom mode (portrait phone): a bottom sheet. Collapsed it is a "peek"
//    strip with the headline; expanded it holds the list.
// One media query (PANEL_QUERY in lib/router.ts) decides, shared with CSS.
//
// It publishes how much of the map it covers (--sheet-right / --sheet-peek)
// so Leaflet's bottom/right controls (attribution!) move clear of it, and it
// carries data-chrome so popups, fits and labels avoid it.

import { useLayoutEffect, useRef } from 'react';
import { fieldColor, type ColorMode, type FieldCollection, type FieldProps, type Machine, type Status } from '../data/demoFarm';
import { KIND_LABEL, equipmentSvg, relTime } from '../map/equipmentIcons';
import { CHROME_EVENT } from '../lib/chrome';
import { TILE_CREDIT } from '../lib/tiles';
import { ChevronIcon, CloseIcon } from './icons';

type Props = {
  side: boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
  fields: FieldCollection;
  machines: Machine[] | null; // null = equipment layer off
  mode: ColorMode;
  selected: string | null;
  totals: { acres: number; done: number; fields: number; left: number };
  onPickField: (p: FieldProps) => void;
  onPickMachine: (m: Machine) => void;
};

const ORDER: Status[] = ['Not started', 'In progress', 'Harvested']; // what's left first

export function ListPanel(props: Props) {
  const { side, open, setOpen, fields, machines, mode, selected, totals, onPickField, onPickMachine } = props;
  const ref = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLButtonElement>(null);

  // Publish the area we cover as CSS variables on the page root.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = (el.closest('[data-page]') as HTMLElement | null) ?? document.documentElement;
    const apply = () => {
      const r = el.getBoundingClientRect();
      root.style.setProperty('--sheet-right', side && open ? `${Math.round(r.width)}px` : '0px');
      const peek = side ? 0 : headRef.current?.getBoundingClientRect().height ?? 0;
      root.style.setProperty('--sheet-peek', `${Math.round(peek)}px`);
      window.dispatchEvent(new Event(CHROME_EVENT));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    // The side panel slides with a transform, which ResizeObserver can't see.
    el.addEventListener('transitionend', apply);
    return () => {
      ro.disconnect();
      el.removeEventListener('transitionend', apply);
    };
  }, [side, open]);

  const pct = totals.acres ? Math.round((totals.done / totals.acres) * 100) : 0;
  const headline = `${totals.done.toLocaleString('en-US')} of ${totals.acres.toLocaleString('en-US')} ac harvested`;
  const hidden = side && !open;

  return (
    <aside ref={ref} aria-label="Fields list" inert={hidden}
      className={`sheet ${side ? 'sheet-side' : 'sheet-bottom'}${open ? ' open' : ''}`}
      data-chrome={side ? 'right' : 'bottom'}>
      {side ? (
        <div className="sheet-head-side">
          <h2>Fields</h2>
          <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close the list"><CloseIcon /></button>
        </div>
      ) : (
        <button ref={headRef} type="button" className="sheet-head" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="grabber" aria-hidden="true" />
          <span className="sheet-head-text">
            <b>Fields</b>
            <small>{headline}</small>
          </span>
          <ChevronIcon up={!open} />
        </button>
      )}

      <div className="sheet-body" hidden={!side && !open}>
        <div className="progress-card">
          <div className="progress-text"><b>{pct}%</b> harvested <span className="muted">· {headline}</span></div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>

        {ORDER.map((status) => {
          const rows = fields.features.map((f) => f.properties).filter((p) => p.status === status);
          if (!rows.length) return null;
          const ac = rows.reduce((s, p) => s + p.acres, 0);
          return (
            <section key={status} className="group">
              <h3 className="group-title">{status} <span className="muted">· {rows.length} · {ac} ac</span></h3>
              {rows.map((p) => (
                <button key={p.id} type="button" className={`row${selected === p.id ? ' selected' : ''}`}
                  aria-current={selected === p.id || undefined} onClick={() => onPickField(p)}>
                  <span className="swatch" style={{ background: fieldColor(p, mode) }} />
                  <span className="row-text"><b>{p.name}</b><small>{p.crop} · {p.acres} ac</small></span>
                </button>
              ))}
            </section>
          );
        })}

        {machines && (
          <section className="group">
            <h3 className="group-title">Equipment <span className="muted">· {machines.length}</span></h3>
            {machines.map((m) => (
              <button key={m.id} type="button" className="row" onClick={() => onPickMachine(m)}>
                <span className="row-icon" dangerouslySetInnerHTML={{ __html: equipmentSvg(m.kind, 32, 24) }} />
                <span className="row-text"><b>{m.name}</b><small>{KIND_LABEL[m.kind]} · seen {relTime(m.lastSeen)}</small></span>
              </button>
            ))}
          </section>
        )}

        <p className="muted small sheet-foot">Demo data is invented. Basemap: {TILE_CREDIT}.</p>
      </div>
    </aside>
  );
}
