# Stocked — App Store Launch Strategy

> **Read `notes/12 Going Public.md` first.** This file is the marketing and
> checklist half. That one covers the four hard gates (a Mac, age of
> majority, real costs, Guideline 4.2) and the three security changes that
> must land *before* strangers use the app — chiefly that the shipped RLS
> policy is `using (true)`, which is safe only while every family owns their
> own Supabase project.

## Competitive Position

**Your unique angle:** Offline-first family inventory with real-time sync. Every competitor goes cloud-only (dead in bad WiFi). You work in the basement with zero network, yet stay in sync when WiFi returns.

### Core Differentiators
1. **Offline-first + real-time family sync** — Unprecedented combo in this category
2. **Free with zero subscription** — No freemium, no ads, no data harvesting
3. **Private data ownership** — You host your data in your own Supabase project
4. **Learned shelf-life** — Gets smarter from your family's real behavior
5. **Free on-device date OCR** — Zero API calls, unlimited, works offline
6. **Voice control** — Hands-free depletion while cooking

## Adoption Strategy

**Target:** Families who cook at home and hate waste. Word-of-mouth from early adopters.

**Entry point:** 
- Emphasize offline-first: "Works in the basement, on the patio, anywhere"
- Emphasize free: "No subscription. Ever."
- Emphasize privacy: "Your data, your cloud. We never see it."

**Growth loop:**
- First user: sets up household, fills pantry via shelf photos (not hand-entry)
- Second user: joins with household code, syncs instantly
- Network effect: family stays in sync in real-time; nobody rebuys what you have

**Positioning line:** "Family inventory, built for offline. Know what's dying, no subscriptions, no waste."

---

## App Store Options

### Option 1: PWA Only (Available Now, Recommended First Step)

**Status:** Live right now at `https://joemil30.github.io/smart-home-inventory/`

**Installation:**
- Android: Chrome → URL → Menu → "Install app" → Home screen
- iOS: Safari → URL → Share → "Add to Home Screen" → Home screen
- Works as fullscreen app with no browser chrome

**Why this path:**
- ✅ Zero native development
- ✅ Auto-updates via the web
- ✅ Works offline and syncs when WiFi returns
- ✅ Live to users today
- ⚠️ No App Store presence (users must share the URL)

**Launch today:**
1. Announce to your family: "Add to home screen"
2. Share the URL: `https://joemil30.github.io/smart-home-inventory/`
3. Watch the adoption curve

---

### Option 2: Wrapped Native App (1–2 weeks, Better Discoverability)

Use **Capacitor** to wrap the PWA as a native app and submit to Google Play and Apple App Store.

**Why this path:**
- ✅ App Store presence (users search and find you)
- ✅ Auto-updates via the App Stores
- ✅ Same codebase as PWA (no rewrite)
- ✅ Native push notifications work better on iOS
- ⚠️ Requires developer accounts ($25 Google once, $99/year Apple forever)
- ⚠️ **iOS requires a Mac** — Xcode is macOS-only, and there is no workaround
- ⚠️ **Both stores require the account holder to be of legal age of majority**
- ⚠️ App Store review can take 1–3 days per update
- ⚠️ Guideline 4.2: a wrapper that loads a *remote* URL gets rejected. Capacitor
  must bundle the app into the binary, and the native capabilities (camera,
  barcode, OCR, notifications) should be called out in the review notes.

**Steps:**
1. Install Capacitor CLI: `npm install -g @capacitor/cli`
2. Initialize: `npx cap init "Stocked" com.stocked.app`
3. Add iOS and Android: `npx cap add ios && npx cap add android`
4. Build web: `npm run build` (or copy index.html, etc. to `www/`)
5. Sync: `npx cap sync`
6. Open Xcode (`npx cap open ios`) and sign with your Apple Developer account
7. Archive and upload to App Store Connect
8. Similar process for Android via Android Studio

**Google Play Store setup:**
- Create Google Play Console account ($25 one-time)
- Create app listing
- Upload APK or AAB via Android Studio
- Fill out required fields (screenshots, description, privacy policy)
- Submit for review (usually 2–4 hours)

**Apple App Store setup:**
- Create App Store Connect account (requires Apple Developer $99/year)
- Create app listing with screenshots
- Archive iOS app and upload via Xcode
- Submit for review (usually 24–48 hours)
- Expect at least one review cycle due to Supabase requirement (review may question cloud sync)

**Timeline for both stores:** ~1 week from Capacitor setup to live in stores

---

### Option 3: True Native App (Months, Best Performance)

Rewrite in Swift (iOS) + Kotlin (Android). Not necessary for your use case—Capacitor works great.

---

## Recommended Launch Path

### Immediate (This Week)
1. ✅ App is ready to go
2. ✅ Test with your family (they install via home screen)
3. ✅ Gather feedback
4. ✅ Announce to early adopters (local family groups, cooking forums)

### Short Term (Next Month)
1. Polish any edge cases from family testing
2. Set up Capacitor and native builds
3. Create app store listing (screenshots, description, privacy policy)
4. Submit to Google Play (usually approves in hours)
5. Submit to Apple App Store (usually approves in 1–2 days)

### Medium Term (2–3 Months)
1. Promote via word-of-mouth (reddit.com/r/cooking, family-focused forums)
2. Encourage reviews in app stores
3. Iterate on features based on family feedback
4. Possibly add features specific to app store versions (richer notifications, etc.)

---

## Marketing Copy (for App Store)

**Title:** Stocked — Family Food Inventory

**Short description:** Family inventory that works offline. No subscription, no ads, no waste.

**Full description:**
```
Know what's in the house. Track what's dying. Cook from what you have. Family syncs in real-time.

✓ Offline first — works in the basement, on the patio, anywhere
✓ Free forever — no subscription, no ads, no data harvesting  
✓ Shared inventory — family members join with a code, synced in real-time
✓ Smart expiry — learns your family's shelf-life, not guessing
✓ Free date scanner — reads printed dates locally, zero API calls
✓ Voice control — "finished the milk", "threw out the spinach"
✓ Your data, your cloud — you host everything in your own Supabase project

Perfect for families who cook at home and hate waste.

__

How it works:

1. Scan a shelf: take a photo, everything recognized lands in one go
2. Barcode incoming groceries: "putting away" flow, unknown codes → photo
3. Eat, toss, use — one tap each
4. Family joins: share a household code, inventory syncs instantly
5. Cook: sorted by "what's dying," pick a recipe, confirm when done

No expiry dates to type. No manual entry. Shelf life is estimated from category × location (freezer vs pantry) and learns from your family's real behavior.

Optional: family cloud sync (Supabase, free tier, you own the data). Optional: free push notifications. Optional: AI-powered label reading (Gemini or OpenRouter).

Works offline. Full indexeddb on-device. Syncs when WiFi returns.

__

For families who cook together.
```

**Keywords:** family, inventory, food, offline, free, no subscription, pantry, grocery, waste reduction, recipe

**Category:** Food & Drink / Lifestyle / Utilities

---

## Data Privacy & Terms

You'll need a privacy policy and terms of service for the app stores.

**Privacy Policy Template (key points):**
- Device-local storage (IndexedDB) — your app owns this
- Optional Supabase sync — user owns their project
- Optional Gemini/OpenRouter API — limited to Gemini/OpenRouter TOS
- No telemetry, no ads, no data harvesting
- User can export/delete everything from within the app

**Post this at:** `https://joemil30.github.io/smart-home-inventory/privacy.html` (or your domain)

Link from app stores to the privacy policy.

---

## Go/No-Go Checklist for Today

- [x] PWA tested and working offline
- [x] All tests passing (13 suites, ~400 checks — `sh test/run.sh`)
- [x] Manifest and icon configured
- [x] GitHub Pages auto-deploys on push
- [x] README documents usage
- [x] Differentiation clear (offline-first + family sync)
- [x] Privacy policy drafted and hosted (`privacy.html`)
- [ ] Test with 2–3 family members (feedback)
- [ ] Own domain bought and pointed at Pages (before sharing the URL widely)
- [ ] GitHub 2FA on, recovery codes saved off-device
- [ ] Trademark search on "Stocked" (USPTO classes 009 + 042)
- [ ] Supabase Auth + `auth.uid()` RLS — **blocks any public launch**
- [ ] AI key moved behind an Edge Function — **blocks any public launch**
- [ ] In-app account deletion (Apple Guideline 5.1.1(v))

**Recommendation:** keep the PWA as the live path for the family. Then
**Android/Play first** — $25, no Mac, no age-of-majority friction in
practice, review in hours — and use it to build every store asset once.
Do the auth/backend rebuild before iOS, not after.
