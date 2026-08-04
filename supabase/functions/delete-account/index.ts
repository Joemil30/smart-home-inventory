/* Account deletion, second half.
 *
 * purge_my_data() (in schema-v2-auth.sql) removes the caller's membership
 * and, if they were the last member, the household's synced rows. It cannot
 * remove the auth.users record itself — that needs the service-role key,
 * which must never leave the server.
 *
 * Apple Guideline 5.1.1(v) requires deletion to be completable inside the
 * app, so this closes the loop.
 *
 * Deploy:
 *   supabase functions deploy delete-account
 * SUPABASE_SERVICE_ROLE_KEY is injected by the platform — do not set it
 * yourself, and never put it in the client.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 204);
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return json({ error: 'Function is not configured.' }, 501);

  /* Establish WHO is asking from their own token. Never accept a user id in
     the request body — that would let anyone delete anyone. */
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Not signed in.' }, 401);

  let uid = '';
  try {
    const who = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: anon },
    });
    if (!who.ok) return json({ error: 'Not signed in.' }, 401);
    uid = (await who.json())?.id || '';
  } catch {
    return json({ error: 'Could not verify who you are.' }, 401);
  }
  if (!uid) return json({ error: 'Not signed in.' }, 401);

  try {
    const res = await fetch(`${url}/auth/v1/admin/users/${uid}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${service}`, apikey: service },
    });
    if (!res.ok && res.status !== 404) {
      return json({ error: 'Could not delete the account. Your data has already been removed.' }, 502);
    }
    return json({ ok: true });
  } catch {
    return json({ error: 'Could not reach the auth service.' }, 502);
  }
});
