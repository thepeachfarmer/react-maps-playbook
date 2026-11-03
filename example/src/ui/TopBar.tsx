// Two-line top bar. Line 1: app icon (a Home button), the page title, the
// user menu. Line 2: this map's own buttons. On a landscape phone the two
// lines collapse into one (see .bar in styles.css: display: contents).
//
// The bar is measured with a ResizeObserver and published as --bar-h, so
// everything under it uses calc(var(--bar-h) + 6px) instead of a fixed number
// that breaks on large text sizes or a notched phone.

import { useRef, type ReactNode } from 'react';
import { measureBottom, useMeasuredVar } from '../lib/chrome';

type Props = {
  title: string;
  onHome: () => void;
  homeLabel: string;
  homeWord?: string;      // shown next to the icon from 560px up
  right?: ReactNode;      // user menu
  tools?: ReactNode;      // line-2 buttons, left side
  toolsEnd?: ReactNode;   // line-2 buttons, right side
};

export function TopBar({ title, onHome, homeLabel, homeWord, right, tools, toolsEnd }: Props) {
  const ref = useRef<HTMLElement>(null);
  useMeasuredVar(ref, '--bar-h', measureBottom);

  return (
    <header ref={ref} className="bar" data-chrome="top">
      <div className="bar-main">
        <button type="button" className="home-btn" onClick={onHome} aria-label={homeLabel} title={homeLabel}>
          <img src="/icon.svg" alt="" width={28} height={28} />
          {homeWord && <span className="home-word">{homeWord}</span>}
        </button>
        <h1 className="bar-title">{title}</h1>
        {right}
      </div>
      {(tools || toolsEnd) && (
        <div className="bar-tools">
          {tools}
          <span className="bar-spacer" />
          {toolsEnd}
        </div>
      )}
    </header>
  );
}
