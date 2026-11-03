# 09 · Mobile first

Most of our maps are used standing in a field, on a phone, in sunlight, sometimes with gloves on. We design for that first and let the desktop version come along for free.

## The four sizes we check every time

| Size | What it stands for |
|---|---|
| **320 × 568** | The smallest phone still in use. If it fits here, it fits anywhere. |
| **390 × 844** | A typical modern phone, held upright. |
| **844 × 390** | The same phone sideways. This is the one people forget. |
| **1280 × 800** | A laptop. |

Nothing ships until every page has been looked at in all four sizes. The public share page (docs/05) is checked separately from the signed-in app.

## 1. A full-screen map that's really full screen

```html
<!-- index.html: no maximum-scale, no user-scalable=no (that blocked every zoom gesture) -->
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

```css
html, body, #root {
  height: 100vh;                          /* fallback */
  height: 100dvh;                         /* "dynamic" viewport: follows the browser's toolbars */
  min-height: -webkit-fill-available;
  width: 100%;
  margin: 0;
}
body { overflow: hidden; overscroll-behavior: none; }
.leaflet-container { height: 100%; width: 100%; touch-action: none; background: #3b3a2f; /* ground colour */ }

@media (max-width: 767px) {
  .leaflet-control-zoom { display: none; }                  /* pinch is enough */
  .leaflet-control-attribution {                            /* one line, so it doesn't cover a corner button */
    max-width: 70vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 9px;
  }
}
```

- **`height: 100%` on `html` and `body`** rendered only the top quarter of the screen in iOS Safari and in the installed PWA. Use `dvh`.
- **`viewport-fit=cover`** lets the page draw under the notch and the home bar. You then pad with safe-area insets (section 3).

### Leaflet measures its box once, so tell it when the box changes

Leaflet reads its container's size when it mounts. On an iPhone home-screen app, the safe areas and `dvh` settle a few frames later. That left white space under the map and tiles off the grid. This helper fixes it:

```tsx
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    let t: number | undefined;
    const go = () => { clearTimeout(t); t = window.setTimeout(() => map.invalidateSize(), 100); };
    const ro = 'ResizeObserver' in window ? new ResizeObserver(go) : null;
    ro?.observe(map.getContainer());
    window.addEventListener('orientationchange', go);
    window.visualViewport?.addEventListener('resize', go);
    go();                                                  // once after mount, too
    return () => {
      clearTimeout(t); ro?.disconnect();
      window.removeEventListener('orientationchange', go);
      window.visualViewport?.removeEventListener('resize', go);
    };
  }, [map]);
  return null;
}
```

Put it inside every `MapContainer`.

## 2. Breakpoints that earned their place

| Rule | What changes |
|---|---|
| `@media (orientation: landscape) and (max-height: 500px)` | **A landscape phone.** The bar becomes one line, subtitles hide, a list sheet narrows to 42vw, labels drop one size, and popups get wider and shorter |
| `max-width: 340–359px` | Drop secondary numbers, hide words using `data-fit` (docs/02), let legend text wrap |
| `max-width: 560px` | Hide the "Maps" text next to the icon and the subtitles, compact the buttons, truncate the title with an ellipsis |
| `min-width: 700px` | A list sheet stays open beside the map, and the share viewer's legend starts open |
| `min-width: 768px` | A list sheet becomes a side panel instead of a bottom sheet, and the zoom buttons come back. Drawers don't change: they slide out the same way at every width (docs/02 section 7) |

**Share one media query between CSS and JavaScript,** so they never disagree:

```ts
const PANEL = matchMedia('(min-width: 768px), (orientation: landscape) and (max-height: 500px)');
PANEL.addEventListener('change', relayout);
```

## 3. Safe areas, on every edge

A notched phone in landscape has its notch on the **side**. Pad all four edges:

```tsx
// Top bar
className="pt-[env(safe-area-inset-top)] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]"
// Bottom controls
className="pb-[calc(env(safe-area-inset-bottom)+1rem)]"
// A full-screen dialog's header, so its close button isn't under the status bar
className="pt-[calc(env(safe-area-inset-top)+0.5rem)]"
```

**In Tailwind arbitrary values, write `calc()` with no spaces:** `top-[calc(env(safe-area-inset-top)+0.75rem)]`. The first space ends the class name, and the style silently doesn't apply.

## 4. Touch

- **Every target is at least 44 × 44 px** (`min-h-11 min-w-11`). That includes Leaflet's popup close button; enlarge it with CSS.
- **When a button must *look* smaller,** extend its hit box without making the bar taller:

```css
.small-btn { position: relative; }
.small-btn::after { content: ''; position: absolute; inset: -8px 0; }   /* invisible, tappable */
```

- **`touch-manipulation`** on buttons removes the double-tap-to-zoom delay. **`touch-action: none`** on `.leaflet-container` keeps map gestures working (docs/02).
- **Debounce tap against double-tap** on shapes by 300 ms (docs/02).
- **Use `matchMedia('(pointer: coarse)')`** to choose touch behaviour, such as the phone's share sheet instead of "copy link".
- **Hide upload and admin-heavy controls on phones.** Nobody uploads a shapefile from a phone in a field.

## 5. Sheets and panels

- **On a phone, dialogs are bottom sheets:** `items-end sm:items-center`, `max-h-[85dvh]`, `rounded-t-3xl sm:rounded-xl`.
- **Use `dvh` for sheet heights** and **`overscroll-behavior: contain`** inside them, so scrolling a list doesn't drag the page or the map.
- **Every sheet has three exits:** an ✕ button, a tap on the backdrop (a real `<button>`, not a `div`), and Escape. Put them in one shared `BottomSheet` component. Once, a mistyped prop silently removed a sheet's exit buttons, and people were stuck.
- **Wide tables inside a sheet** scroll sideways with a sticky first column (`position: sticky; left: 0`), and the sheet itself gets `overflow-x: hidden`.
- **Rows of chips that scroll sideways** fade at their edges, so people can see there's more:

```css
.chips { overflow-x: auto; mask-image: linear-gradient(to right, transparent, #000 12px, #000 calc(100% - 12px), transparent); }
```

## 6. Numbers and text

- **`font-variant-numeric: tabular-nums`** on anything that counts or updates, so digits don't jiggle.
- **Truncate titles** (`min-w-0 flex-1 truncate`) instead of letting them wrap the bar to three lines.
- **Measure, don't assume.** Large-text settings make bars taller. Measure the bar with a `ResizeObserver` and publish `--bar-h` / `--header-h` (docs/01, docs/02).
- **Respect `prefers-reduced-motion`:** a still image instead of the animated loader (docs/04), and no slide animations.

## 7. Installed apps (PWA) on phones

- **There's no Back button in an installed iOS app.** Every page needs a visible way Home: the app icon in the top bar (docs/02), and a "came from Home" link on viewer pages.
- **A crash must never leave a blank screen.** Use an error boundary (docs/01), a boot watchdog and "Clear cache & reload" (docs/08).
- **Location needs HTTPS,** and a page served over plain http on your LAN won't get GPS (docs/02).
- **Icons and updates behave differently on each platform** (docs/04).

## 8. How to actually test at phone sizes

**Headless Chrome's `--window-size` lays pages out wider than you asked.** Screenshots taken that way look fine and lie to you. Use one of these instead:

- **Playwright with a real viewport** (the easiest):

```js
// scripts/shots.mjs. First: npm i -D playwright && npx playwright install chromium
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173/map';
const sizes = [[320, 568], [390, 844], [844, 390], [1280, 800]];
const browser = await chromium.launch();

for (const [width, height] of sizes) {
  const phone = width < 900;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);                                   // let tiles and labels settle
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) console.log(`!! horizontal scroll at ${width}x${height}`);
  await page.screenshot({ path: `outbox/shot-${width}x${height}.png` });
  await page.close();
}
await browser.close();
```

Run it as `node scripts/shots.mjs http://localhost:5173/map`, then look at every picture.

- **A harness page:** render the app inside fixed-size `<iframe>`s (320×568, 390×844, 844×390) on one page and drive it over the Chrome DevTools Protocol. This is handy for seeing all sizes side by side.
- **A real phone.** Nothing replaces it for safe areas, sunlight readability and fat fingers. Rotate it while a sheet is open. Re-run label placement when it rotates (docs/02).

**What to look for in every screenshot:**

- [ ] No horizontal scroll, and nothing cut off at the right edge.
- [ ] The top bar is one or two lines, the title is truncated, and the user menu is visible.
- [ ] Nothing important is under the notch, the status bar or the home indicator.
- [ ] The open drawer or sheet still leaves the map usable (landscape: more than half the screen).
- [ ] Popups aren't hidden under the bar, and labels don't overlap the UI.
- [ ] The user menu opens **on top** of everything (docs/03).
- [ ] Every button looks big enough to hit with a thumb.
