# Auth, and closing the `using (true)` hole

Written 2026-08-04. Everything here exists so the app can be opened to
strangers without a breach on day one. None of it is switched on for the
user's own family, and nothing about their current setup changes.

Related: `[[06 Family Sync]]` (how sync works today), `[[12 Going Public]]`
(why this is the gate on a public launch).

## The problem, stated plainly

`supabase/schema.sql` ships:

```sql
create policy "family access" on public.sync for all using (true) with check (true);
```

Anyone holding the anon key may read and write **every row in the table**.

That is safe today, and deliberately so: each household runs its own
Supabase project, so the only people with the key are the family, and the
household code is a full random UUID. The family *is* the tenant.

It becomes a total breach the moment one backend serves many households,
because the anon key ships inside the app and can be read out of the bundle
by anyone who cares. No amount of client-side care changes that — the client
is the attacker's machine.

## What replaces it

`supabase/schema-v2-auth.sql`. The database decides, not the client.

- **`household_members`** — (household, user_id) rows. Membership is a fact
  in the database, not a string the client sends.
- **`is_member(household)`** — `SECURITY DEFINER`, because the check itself
  has to read a table that RLS hides from the caller. Without that, every
  policy fails closed and nobody sees anything.
- Every policy on `sync` is `using (is_member(household))`.
- The old permissive policy is dropped **by name and then by loop**, because
  a project that ran an earlier revision may carry a differently-named twin.
  Dropping only the name you expect is how these holes survive migrations.
- `create_household()` inserts the household and its owner in one
  transaction, so there is never an instant where a household exists that
  nobody can read.
- `redeem_invite()` is the only path that adds you to someone else's
  household, and it checks an expiring, use-capped code. Invites are
  deliberately **not** readable by non-members, so a code can't be found by
  querying the table.

Verification query is at the bottom of the file: any policy whose `qual` is
`true` is a hole.

## The AI key

`supabase/functions/ai/index.ts`. Today each user pastes their own Gemini
key, which is honest and safe. The temptation when going public is to embed
one so it "just works" — anything in a bundle is extractable in minutes, and
the bill arrives before the discovery does.

The proxy holds the key as a function secret, requires a signed-in user
(an unauthenticated proxy is just a free Gemini endpoint with your card
behind it), rate-limits per user, and **pins the model server-side to an
allowlist** — letting the client name the model is how a proxy quietly
becomes a way to spend your quota on the most expensive thing available.

## Accounts

Email magic link only. Not laziness: **Apple Guideline 4.8** says offering
any third-party sign-in (Google, Facebook) obliges you to offer Sign in with
Apple as well. Email-only sidesteps that, and holds the least data possible.

**Guideline 5.1.1(v)** requires that an account created in the app be
deletable *in* the app — not by email, not by a web form. It's a common
rejection. Deletion is two halves because they fail differently:

1. `purge_my_data()` removes membership, and the household's rows if you
   were the last one out. This is the part that matters for privacy.
2. `functions/delete-account` removes the `auth.users` record using the
   service key, which can never ship in a client.

If step 2 fails, step 1 has still happened, so the user is un-joined from
everything. The UI requires typing `DELETE` — it is the only action in the
app that no toast can undo.

## What the client already does

`AUTH` in `index.html` — session load, magic link, sign out, delete. The
Settings card appears only once Supabase details exist, and says outright
that it's unnecessary under the v1 schema.

One real change shipped to everyone: `persistSession` is now **on**. Under
v1 there was no session to keep, since the anon key plus a household code
*was* the credential. Under v2 a session that doesn't survive a reload means
signing in every launch.

## Order of operations, when the day comes

1. Run `schema-v2-auth.sql` on the project.
2. Run the verification query. Any row returned means stop.
3. Deploy `functions/ai` and `functions/delete-account`; set `GEMINI_KEY`.
4. Have every existing member sign in once and `redeem_invite()` into the
   household they already use — the household id does not change, so their
   data is waiting for them.
5. Only then point a second family at the same project.
