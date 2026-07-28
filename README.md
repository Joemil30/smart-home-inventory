# Stocked

Household food inventory. Six shelves, barcode in, wrapper out, cook from what's dying.

Local-first: everything lives in the browser's IndexedDB on the device. No account, no server, works with the wifi off. That's not a shortcut — your downstairs freezer has bad signal, and an inventory app that won't load in the basement is a dead app.

---

## Getting it on your phone

Camera access requires HTTPS. A file on your desktop won't do it, and neither will `python -m http.server` over your LAN — browsers refuse camera on plain `http://192.168.x.x`. So it needs a real HTTPS host. Free options, easiest first:

**Netlify Drop** — go to `app.netlify.com/drop`, drag this whole folder onto the page. You get an HTTPS URL in about ten seconds. No account needed to start.

**Cloudflare Pages / GitHub Pages** — same idea, if you'd rather own the repo.

Then on the phone: open the URL → Share → **Add to Home Screen**. It launches fullscreen with no browser chrome and works offline from then on.

## First run

The setup screen asks the things the recipe engine actually needs — who eats, allergies, what's always in the house. The staples list matters more than it looks: without it every suggestion reads "missing 1 ingredient: salt."

## Filling it (the 500-item problem)

Don't hand-enter your house. You won't finish, and the project dies before the habit ever forms.

Go shelf by shelf: open the shelf you want in the picker, hit Scan → **Shoot a whole shelf**, and photograph it. Everything recognised lands on that shelf in one go. Untick whatever it got wrong. A pantry takes a couple of photos; the whole house takes an evening rather than a weekend.

Barcodes are for the *grocery-bag* flow afterwards, not for the initial fill.

## Barcode scanning

Uses the browser's native `BarcodeDetector` where it exists, and falls back to a bundled **ZXing** decoder where it doesn't.

| | Barcode scanning |
|---|---|
| Chrome / Edge on Android | Native `BarcodeDetector` |
| Chrome on desktop | Native `BarcodeDetector` |
| **Safari on iOS / iPadOS** | **ZXing fallback — works** |

The ZXing decoder (`zxing.min.js`) is vendored, not pulled from a CDN, and the service worker pre-caches it — so iPhone scanning still works offline in the basement. It loads lazily: browsers with native detection never download it. iOS still needs HTTPS and a one-time "Allow" on the camera prompt.

Barcodes resolve against **Open Food Facts**: free, no key, no rate limit, ~3M products.

## Gemini (optional)

Only needed for label reading, produce photos, and recipes. Barcodes work without it.

1. Free key at `aistudio.google.com`
2. Setup tab → paste it → **Fetch models this key can use**

No model name is hardcoded anywhere. Google killed `gemini-2.0-flash` in June 2026 and moved Pro to paid-only in April; anything pinned in source rots within months. The app asks your key what it can do and lists the answers. Pick a **Flash** tier — those are the free ones.

**Know this:** on the free tier Google may use what you send to train their models. Here that means photos of your kitchen and your groceries. Enabling billing opts you out and costs roughly nothing at household volume.

---

## How it's meant to be used

**Putting groceries away** — Scan tab, "Putting away." Barcode the packaged half. Unknown code (hi, Kirkland) → it asks once, remembers forever. The unbarcoded half goes in by photo — shoot the whole counter at once.

For a whole bag at once, flip on **⚡ Rapid add** and pick the shelf: now every known scan drops straight onto that shelf with a beep and a line in a running tally (undo any of them, or the whole run) — no dialog per item. Only unknown codes stop to ask. Every scan flashes the reticle green and beeps, so it's obvious it landed even on iPhone, where there's no vibration. Scanning a dim shelf like the downstairs freezer? A **🔦 flashlight** toggle appears on the scanner where the camera supports it (Android; iOS Safari doesn't expose it).

**Eating** — the `−` button on any row. One tap.

**Binning** — Scan tab, flip to "Trash / used up," scan the empty wrapper as it goes in the bin. Same gesture as putting it away, opposite sign. This is the one habit that keeps the whole thing honest.

**Cooking** — Cook tab → "Cook with what I have." Sorted by nothing-missing first, then by whatever burns down the expiring list hardest. Hit "I made this" and it deducts — but confirms first, because the recipe is theory and your counter is reality.

**Something rotted** — `⋯ → Threw it out`. Don't skip this. The waste log is the only feature here that saves money instead of just organising.

## Under the hood

- **Restock hints are learned, never assumed.** Your pantries hold different food — downstairs is not overflow of upstairs. So "you have it on the other shelf" only appears for items that have genuinely lived on both. Depleted items are kept forever, so that history builds itself. Silent until it has evidence.
- **Built for 500+.** Search is the front door. Shelves group into collapsible categories that sort dying-first and only build their rows when opened, so a tap never re-renders five hundred things.
- **Opens on what's dying**, not on the inventory. You said this is purely about not wasting food, so that's the daily check-in. "Nothing dying" is a good thing to see.
- **No expiry dates get typed.** Shelf life is estimated from category × shelf kind. Bread in the pantry is 4 days; the same loaf in the downstairs freezer is 90. Moving an item re-estimates it. Override only when you disagree.
- **Opened changes everything.** Unopened soft cheese, 10 days. Opened, 7. That gap is where most household waste hides.
- **Quantities pick themselves.** Countable things get counts. Bulk things (milk, flour, oil) get full/most/half/low/out. Costco multipacks get container + units left.
- **Vision is constrained matching, not recognition.** Photos are sent along with your actual inventory and the question "which of these do you see?" Worst case it picks the wrong onion instead of inventing a mango.
- **Nothing destructive is one tap.** Everything soft-deletes with a 6-second undo.

## The family layer

Once you've lived on the core loop, the shared pieces bolt on — same data model, no rewrite:

- **Receipt scanning** — Scan tab → **🧾 Scan a receipt** photographs a receipt and adds the whole trip in one AI call.
- **Free on-device date OCR** — item sheet → **📅 Scan the printed date** reads Best By / Use By dates locally (Tesseract), no AI quota, works offline, unlimited.
- **Voice trash/eat** — mic button on the Expiring screen: "finished the milk", "threw out the bad spinach", "add eggs to the list".
- **Shared shopping list** — 🛒 header button, with an IN STOCK / not-in-the-house badge per line so nobody rebuys what you already have.
- **Family cloud sync** — optional Supabase project + a shared household code; last-write-wins, realtime, offline queue. Setup is guided in-app (Settings → Family sync).
- **Push notifications** — free web push via a Supabase Edge Function (`supabase/functions/notify`). Best-effort on iOS (installed PWA, iOS 16.4+).
- **Swappable AI provider** — Gemini or any OpenAI-compatible endpoint (OpenRouter's free vision models by default). No model name is hardcoded; dead models heal at boot.

## Files

```
index.html            the whole app
sw.js                 offline shell
manifest.webmanifest  home-screen install
icon.svg              app icon
apple-touch-icon.png  iOS home-screen icon (iOS ignores the SVG)
zxing.min.js          barcode decoder for iOS — vendored, lazy-loaded, pre-cached
```

Export everything to JSON from the Setup tab whenever you want out.
