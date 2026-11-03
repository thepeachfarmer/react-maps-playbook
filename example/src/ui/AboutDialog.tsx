import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './icons';

// Build info is baked in at build time (Vite inlines import.meta.env.VITE_*).
// A real app would read it from /api/about so "did my redeploy take?" is a
// comparison of commit SHAs, not a guess.
const VERSION = import.meta.env.VITE_APP_VERSION || '1.0.dev';
const COMMIT = import.meta.env.VITE_COMMIT_SHA || 'local';
const BUILT_AT = import.meta.env.VITE_BUILT_AT || 'not set';

/** A modal: portaled to body, z 2000 (above drawers, below the user menu). */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="about-title" className="modal">
        <div className="modal-head">
          <h2 id="about-title">About this demo</h2>
          <button ref={closeBtn} type="button" className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
        <p>A small React + Leaflet map that shows the patterns from the playbook: drawers, a list panel or bottom sheet, a portaled menu, popups and labels that stay clear of the UI.</p>
        <p><strong>Every field, machine and name on this map is invented.</strong></p>
        <dl className="kv">
          <dt>Version</dt><dd>{VERSION}</dd>
          <dt>Commit</dt><dd className="num">{COMMIT.slice(0, 12)}</dd>
          <dt>Built</dt><dd>{BUILT_AT}</dd>
        </dl>
      </div>
    </div>,
    document.body,
  );
}
