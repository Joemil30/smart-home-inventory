# Going public — owning it, and getting it into the App Store

Written 2026-07-31, when the question moved from "does my family like this"
to "I want strangers to use this." Everything here is the honest version,
including the parts that cost money and the parts that are currently unsafe
for strangers.

Related: `[[06 Family Sync]]` (the backend as it exists today),
`[[07 Icon and Branding]]`, `APP_STORE_LAUNCH.md` (the checklist form of this).

---

## Part 1 — "Independent, and I can't lose it"

First, a correction that matters: **GitHub is not the risk, it's the
backup.** The code lives in a git repo that is copied in full to GitHub's
servers. If this laptop, this phone and this session all vanished, the app
would still be there. The thing that could actually lose the app is losing
*the GitHub account* — so that's what gets protected, not avoided.

Independence is four separate layers, and they fail separately:

### 1. The code (free, do today)
- **2FA on GitHub, and save the recovery codes somewhere that isn't the
  phone** — a screenshot in iCloud Notes, or printed. Account lockout is
  the single realistic way to lose everything.
- **A second remote.** A git repo can push to more than one place. Adding a
  GitLab or Codeberg mirror costs nothing and means no one company holds
  the only copy.
- **A dated zip in iCloud Drive**, once a month. Dumb, but it survives every
  scenario the clever options don't.

### 2. The address (~$12/year, the highest-value thing on this page)
Right now the app IS its URL: `joemil30.github.io/smart-home-inventory/`.
That address belongs to GitHub, contains a username, and can never move.
Every person who adds it to their home screen is bookmarking GitHub's
domain, not Stocked's.

**Buy a domain** (`getstocked.app`, `stocked.family`, whatever survives the
trademark check below) and point it at GitHub Pages. Nothing about the app
changes, the deploy stays free — but from that day forward the app can move
to any host on earth without a single user losing their icon. Do this before
telling anyone about the app, because after that the URL is load-bearing.

### 3. The name (free, do before spending money on branding)
"Stocked" is a common English word, which is both why it's good and why it
may already be registered. Before printing anything or filing anything:
search **tmsearch.uspto.gov** for "Stocked" in class 009 (software) and 042
(SaaS). Also just search the App Store. Apple rejects names that infringe an
existing mark, and finding out at review is an expensive way to learn.

### 4. The backend (this is the one that costs real money later)
See Part 3. Today every family brings their own Supabase project, which is
genuinely elegant and costs nothing. That model does not survive contact
with strangers.

---

## Part 2 — What actually stands between here and the App Store

Four hard gates. None are skippable, and two of them are the kind nobody
mentions until you hit them.

### Gate 1: a Mac
Xcode runs on macOS only. There is no workaround for shipping to iOS — not
a VM, not a web service that's worth trusting with a signing key. Options,
cheapest first: borrow a school/library Mac, rent a cloud Mac by the hour
(MacStadium, MacinCloud), or buy a used Mac mini.

**Android needs no Mac.** Android Studio runs on Windows and Linux. This is
a large part of why the order in Part 4 is what it is.

### Gate 2: age
The Apple Developer Program requires the account holder to be the **legal
age of majority** — 18 in most of the US. For a high-school senior this is
frequently the actual blocker, and it has three exits:
- Wait until 18.
- **A parent or guardian enrolls** as an individual and you build under it.
  Simple, immediate, but the app legally belongs to them.
- **Form an LLC and enroll as an organization.** Costs $50–500 depending on
  the state, needs a free D-U-N-S number (allow 1–2 weeks), and Apple asks
  for proof of legal authority to bind the entity — which usually means an
  adult member. The upside is the app belongs to a company you own, which is
  also the cleaner story if this ever becomes a real business.

Google Play has the same age-of-majority requirement, but enforces it far
more lightly.

### Gate 3: money
| Thing | Cost |
|---|---|
| Apple Developer Program | **$99/year, forever** — the app is delisted if it lapses |
| Google Play Console | **$25 once** |
| Domain | ~$12/year |
| Supabase Pro (needed once real users exist) | **$25/month** |
| LLC, if that route | $50–500 once |

The Supabase line is the one that surprises people: the free tier **pauses a
project after 7 days of inactivity** and is capped hard. Fine for a family
project. Not fine when strangers depend on it.

### Gate 4: App Review Guideline 4.2, "minimum functionality"
Apple rejects apps that are a web page in a box. A Capacitor wrapper that
loads a remote URL is a near-certain rejection.

What makes it pass is that the app is *actually native*: Capacitor bundles
`index.html` **inside the binary** so it works with the network off, and it
uses real device capabilities. Stocked already has the strong version of
this story — camera, barcode scanning, on-device OCR, notifications, offline
storage. That should be led with in the review notes, not buried.

---

## Part 3 — Security and privacy, honestly

The current design is a good design *for one family*. Three specific things
in it are unsafe the moment a stranger installs the app, and they should be
fixed before launch rather than after.

### The row-level security policy is wide open
`supabase/schema.sql` ships:

```sql
create policy "family access" on public.sync for all using (true) with check (true);
```

That says: *anyone holding the anon key may read and write every row in the
table.* Today that's fine, because each family owns their own project and
their own key — they're the only ones who have it, and the household code is
a full random UUID. It is a deliberate, documented trade-off.

It becomes a **total data breach** the day one shared backend serves many
households, because the anon key ships inside the app and can be read out of
the binary by anyone who cares. The fix is not a patch, it's the migration
in the next section.

### API keys must never ship in the binary
Today the user pastes their own Gemini/OpenRouter key, which is honest and
safe. The temptation when going public is to embed one key so it "just
works." Anything shipped in an app binary is extractable in minutes, and the
bill arrives before the discovery does.

The fix: move AI calls behind a **Supabase Edge Function** that holds the key
as a server-side secret and enforces a per-user rate limit. The client sends
the photo, the server calls Gemini. There's already a function deployed for
push (`supabase/functions/notify/`), so the pattern is established.

### Real accounts, and what Apple demands of them
Household-code-as-shared-secret has to become **Supabase Auth**, with RLS
rewritten around `auth.uid()` and a `household_members` join table, so the
database enforces "you may only see rows for households you belong to"
rather than trusting the client.

Apple's rules once accounts exist:
- **Guideline 4.8** — if any third-party sign-in is offered (Google,
  Facebook), **Sign in with Apple must also be offered.** Offering only
  email magic-link avoids this entirely, which is a legitimate reason to
  start there.
- **Guideline 5.1.1(v)** — if an account can be created in the app, it must
  be **deletable from inside the app**. Not by email, not by a web form. A
  real, working delete button. This is a common rejection.
- **App Privacy "nutrition label"** in App Store Connect must be filled in
  accurately, and a **privacy policy URL** is mandatory. `privacy.html` is
  already written and hosted — it needs updating the moment the data model
  changes, because an inaccurate label is itself a violation.

### Becoming a data custodian
Hosting other people's data changes the legal posture. Grocery data is
low-sensitivity, which helps, but the baseline still applies: GDPR and CCPA
both require **export** and **delete** (the app already has both — keep
them), a real contact email in the policy, and honesty about processors
(Supabase, and any AI provider). Do not add analytics that collect more than
is needed; "we collect nothing" is both the current truth and the strongest
marketing line the app has.

Also: **do not target under-13s.** The moment a kids' audience is claimed,
COPPA applies and the compliance burden multiplies.

---

## Part 4 — The order to actually do it in

Most people do Apple first and stall for months on a Mac and a birthday.
Backwards. Real users are what make the rest worth doing.

**Phase 0 — this week, ~$12, no permission needed from anyone**
Domain bought and pointed at Pages. GitHub 2FA + recovery codes saved.
Second git mirror. Trademark search done. Privacy policy re-read for
accuracy. App icon exported at 1024×1024 **PNG, opaque, square, no
transparency and no pre-rounded corners** — both stores reject alpha
channels, and both round the corners themselves.

**Phase 1 — Android first, $25, no Mac, review in hours**
Capacitor wrap → Play Console → live. Every store-listing asset (screenshots,
description, privacy URL, content rating, data-safety form) gets built once
here and reused for Apple later. Real strangers, real feedback, on the
cheapest possible path.

**Phase 2 — the backend rebuild, before iOS**
Supabase Auth + `auth.uid()` RLS + membership table, AI key moved to an Edge
Function, in-app account deletion, Supabase Pro. This is the largest chunk
of engineering on the page and it is the gate on being allowed to have
strangers at all — not just an Apple checkbox.

**Phase 3 — iOS**
Only once there's a Mac and a valid enrollment. TestFlight first, always:
free, unlimited internal testers, and it catches the "works in Chrome,
breaks in WKWebView" class of bug before a reviewer finds it.

---

## What stays true regardless

The app's actual competitive advantage is that it works with the network
off and costs nothing. Every architectural decision that gets made under
launch pressure should be checked against those two, because they're the
only two things no competitor in this category has.
