// A pill under the bar that always shows the headline number. Tapping it
// opens the list. When it doesn't fit, a loop steps data-fit 0 -> 1 -> 2 and
// CSS hides the less important phrases at each level. The full meaning is
// always in aria-label.

import { useLayoutEffect, useRef } from 'react';
import { CHROME_EVENT } from '../lib/chrome';

type Props = { done: number; acres: number; fields: number; left: number; machines: number; onClick: () => void };

export function TotalsChip({ done, acres, fields, left, machines, onClick }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const n = (v: number) => v.toLocaleString('en-US');

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      for (let k = 0; k <= 2; k++) {
        el.dataset.fit = String(k);
        if (el.scrollWidth <= el.clientWidth) break;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement ?? el);
    window.addEventListener(CHROME_EVENT, fit); // e.g. the side panel opened
    return () => {
      ro.disconnect();
      window.removeEventListener(CHROME_EVENT, fit);
    };
  }, [done, acres, fields, left, machines]);

  return (
    <button ref={ref} type="button" className="chip" data-chrome="top" onClick={onClick}
      aria-label={`${n(done)} of ${n(acres)} acres harvested, ${fields} fields, ${left} left to harvest, ${machines} machines. Open the list.`}>
      <b>{n(done)} of {n(acres)} ac</b>
      <span className="fit-1"> harvested</span>
      <span className="fit-2"> · {left} fields left</span>
      <span className="fit-3"> · {machines} machines</span>
    </button>
  );
}
