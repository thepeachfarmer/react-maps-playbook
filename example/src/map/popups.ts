// Popups are built when they open, with options computed from what's on
// screen at that moment (see popupOptions in lib/chrome.ts), so they autopan
// clear of the top bar, the totals chip, the legend and an open list panel.

import L from 'leaflet';
import { fieldColor, type ColorMode, type FieldProps, type Machine } from '../data/demoFarm';
import { popupOptions } from '../lib/chrome';
import { esc } from '../lib/esc';
import { KIND_LABEL, equipmentSvg, relTime } from './equipmentIcons';

export function openFieldPopup(map: L.Map, p: FieldProps, mode: ColorMode, at?: L.LatLngExpression) {
  const html =
    `<div class="pop">` +
    `<div class="pop-title"><span class="swatch" style="background:${esc(fieldColor(p, mode))}"></span>${esc(p.name)}</div>` +
    `<dl class="pop-grid">` +
    `<dt>Crop</dt><dd>${esc(p.crop)}</dd>` +
    `<dt>Status</dt><dd>${esc(p.status)}</dd>` +
    `<dt>Area</dt><dd>${esc(p.acres)} ac</dd>` +
    `</dl>` +
    `<p class="pop-note">Invented demo field.</p>` +
    `</div>`;
  L.popup(popupOptions(map))
    .setLatLng(at ?? [p.label.lat, p.label.lng])
    .setContent(html)
    .openOn(map);
}

export function openMachinePopup(map: L.Map, m: Machine) {
  const html =
    `<div class="pop">` +
    `<div class="pop-title pop-title-icon">${equipmentSvg(m.kind, 32, 24)}${esc(m.name)}</div>` +
    `<dl class="pop-grid">` +
    `<dt>Type</dt><dd>${esc(KIND_LABEL[m.kind])}</dd>` +
    `<dt>Last seen</dt><dd>${esc(relTime(m.lastSeen))}</dd>` +
    `<dt>Position</dt><dd class="num">${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}</dd>` +
    `</dl>` +
    `</div>`;
  // The icon is centred on the point, so lift the popup tip clear of it.
  L.popup(popupOptions(map, { offset: L.point(0, -12) }))
    .setLatLng([m.lat, m.lng])
    .setContent(html)
    .openOn(map);
}
