# Photos, theme, and expiry

Three separate visual/UX systems that each had a real bug and fix.

## Photo framing

Item tiles use a CSS grid with `place-items:center`. That sizes grid cells
to their content — so a plain `<img style="height:100%">` inside never
actually resolved to the tile's height, and photos rendered "wonky"
(overflowing/misaligned). This was **misdiagnosed twice** as an
`object-fit: contain` problem before the real cause was found.

**Fix:** `photoLayers()` (index.html) emits two `<img>` elements per tile —
a blurred, cover-fit background (fills the tile, hides the mismatch) and a
sharp, `position:absolute` + `object-fit:contain` foreground (which now has
something to size against, since `position:absolute` takes it out of grid
sizing). This is also what makes tiles with non-square product photos look
intentional instead of letterboxed.

## Theme (light/dark)

Originally the theme flip-flopped a few times (dark green → light green →
back) before settling. The real bug: the status-bar color `<meta>` tag used
`media="(prefers-color-scheme: ...)"`, which follows the **phone's** theme
setting, not the app's own light/dark toggle — so switching the in-app
theme didn't move the status bar. `applyTheme()` now drives a single meta
tag directly from the app's effective theme (`syncThemeColor()`), and
there's a theme-change event listener so it stays in sync live. Settings →
Appearance now has an explicit, labelled light/dark/system switch instead
of silently following the OS.

## Expiry / shelf life

Item expiry dates are estimated, never hand-typed, from a
category × storage-location table (`SHELF` in index.html) — deliberately
conservative "actually still safe" numbers, not the printed "best by" date
(a marketing artifact). Backed by:
- **Printed-date reading**: free, on-device OCR (Tesseract), no AI quota,
  unlimited — a live-video scanner that reads dates off packaging.
- **Verification**: only high-risk categories get a "still good?" nudge;
  the rest is trusted to the table.
- **Per-store/family learning**: corrections nudge the estimate for that
  category over time (see `[[06 Family Sync]]` for the shared version).

See `[[08 iOS Safari Quirks]]` for camera/OCR quirks specific to iOS
Safari, if any turn up.
