# 09 · Mobile pass (320 / 390 / landscape / desktop)

**Use it when:** a page "works" but you haven't really looked at it on a phone. Run it after any UI change.
**Fill in:** `<pages>` (e.g. "/, /map, /s/<placeholder-token>"), plus anything you've noticed yourself.
**Read first:** `docs/playbook/09-mobile-first.md` (all of it), and `docs/playbook/02-the-map-page.md` sections 7, 8 and 10.

```text
Goal
Make these pages work well on phones without hurting desktop: <pages>.
Check every one at 320x568, 390x844, 844x390 (landscape phone) and 1280x800, find the problems, fix them,
and show me before and after.
Read docs/playbook/09-mobile-first.md first.

Step 1: look (no code changes yet)
- Add scripts/shots.mjs (Playwright, real viewport, isMobile and hasTouch for phone sizes, deviceScaleFactor 2)
  from docs/playbook/09-mobile-first.md section 8. It also prints "!! horizontal scroll" when
  document.documentElement.scrollWidth > innerWidth.
- Take "before" screenshots of every page at every size, with: nothing open; the left drawer open; the
  right drawer or list open; a popup open; the user menu open.
- List every problem you see, with the screenshot it's in. Show me the list before fixing.

Step 2: fix, using these rules
- html/body/#root height 100dvh (not 100%), body overflow hidden, overscroll-behavior none.
- viewport meta with viewport-fit=cover, no maximum-scale and no user-scalable=no.
- An InvalidateOnResize helper inside every MapContainer.
- env(safe-area-inset-*) on every edge, including left/right at every width. Tailwind calc() with no spaces.
- Touch targets at least 44px (use an invisible ::after hit box if a button must look smaller).
  touch-manipulation on buttons, touch-action:none on .leaflet-container.
- Landscape phone = (orientation: landscape) and (max-height: 500px): one-line bar, subtitles hidden, a list
  sheet (if the page has one) at about 42vw, labels one size smaller, popups wider and shorter.
- Drawers stay slide-out drawers at every size. Only a list sheet changes shape: a bottom sheet on a
  portrait phone, a side panel from 768px or on a landscape phone (docs/playbook/02-the-map-page.md
  sections 7 and 10).
- At 560px and below: hide the "Maps" text and subtitles, truncate the title. At 340-359px and below: drop
  secondary numbers (data-fit levels) and let legend text wrap.
- Under 768px: hide the Leaflet zoom control, and truncate the attribution to one line at 9px.
- Sheets and dialogs use dvh heights, overscroll-behavior contain, and three exits (X, backdrop button,
  Escape).
- Numbers use tabular-nums. Chip rows that scroll fade at their edges.
- Popups and fitBounds account for the bar and any open sheet (--bar-h, topInset()).
- Hide upload and admin-heavy controls on phones.

Constraints
- Don't redesign anything. Fix what's broken and keep the look.
- No new dependencies besides Playwright (as a devDependency).
- One commit per kind of fix, so I can review them separately.

Acceptance checks
- No horizontal scroll on any page at any size (the script prints nothing).
- Nothing important under the notch, status bar or home indicator in the phone screenshots.
- In landscape, an open sheet leaves more than half the map visible.
- The user menu opens on top of everything at every size.
- Every button is at least 44px in its smallest dimension (measure a few with getBoundingClientRect and
  print them).
- Desktop at 1280x800 looks the same as before, or better.

How to verify (show me)
- outbox/mobile-before/ and outbox/mobile-after/, with the same file names so I can flip between them.
- The problem list from step 1 with each item marked fixed, or not fixed and why.
- The build output.
```
