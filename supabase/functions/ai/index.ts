/* AI proxy.
 *
 * Why this exists: anything shipped inside an app binary or a web bundle is
 * extractable in minutes. A Gemini key in the client is a key on the
 * internet, and the bill arrives before the discovery does. So when the app
 * is opened to strangers, the key lives here as a function secret and the
 * client never sees it.
 *
 * Today the app asks each user for their own key, which is honest and safe —
 * this function is what makes a hosted, key-less version possible without
 * repeating the classic mistake.
 *
 * Deploy:
 *   supabase secrets set GEMINI_KEY=...          # never commit this
 *   supabase functions deploy ai
 *
 * The client calls it exactly like G.gen(): { parts, schema, model }.
 */

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

/* Per-user rate limiting. In-memory, so it resets when the function's
 * container recycles — which is fine for its actual purpose: stopping one
 * account from burning a shared quota in a loop. A determined attacker
 * needs an account first, and abuse across cold starts is caught by
 * Supabase's own limits rather than pretended-at here. */
const HOURLY = 40;
const seen = new Map<string, { n: number; until: number }>();

function overLimit(user: string): boolean {
  const now = Date.now();
  const rec = seen.get(user);
  if (!rec || rec.until < now) { seen.set(user, { n: 1, until: now + 3600_000 }); return false; }
  rec.n += 1;
  return rec.n > HOURLY;
}

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

  const key = Deno.env.get('GEMINI_KEY');
  if (!key) return json({ error: 'This deployment has no AI key configured.' }, 501);

  /* Identify the caller through Supabase Auth. An unauthenticated proxy is
     just a free Gemini endpoint with your credit card behind it. */
  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Sign in to use the shared AI.' }, 401);

  let user = '';
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: Deno.env.get('SUPABASE_ANON_KEY') || '' },
    });
    if (!res.ok) return json({ error: 'Sign in to use the shared AI.' }, 401);
    user = (await res.json())?.id || '';
  } catch {
    return json({ error: 'Could not verify who you are.' }, 401);
  }
  if (!user) return json({ error: 'Sign in to use the shared AI.' }, 401);
  if (overLimit(user)) return json({ error: `That's ${HOURLY} AI reads this hour — try again later.` }, 429);

  let body: { parts?: unknown[]; schema?: unknown; model?: string };
  try { body = await req.json(); } catch { return json({ error: 'Bad request body.' }, 400); }
  const parts = Array.isArray(body.parts) ? body.parts : null;
  if (!parts || !parts.length) return json({ error: 'Nothing to read.' }, 400);

  /* Pin the model server-side to a small allowlist. Letting the client name
     the model is how a proxy quietly becomes a way to spend your quota on
     the most expensive thing available. */
  const ALLOWED = ['gemini-2.5-flash', 'gemini-2.0-flash-001', 'gemini-flash-latest'];
  const model = ALLOWED.includes(String(body.model)) ? String(body.model) : ALLOWED[0];

  const payload: Record<string, unknown> = { contents: [{ parts }] };
  if (body.schema) {
    payload.generationConfig = { response_mime_type: 'application/json', response_schema: body.schema };
  }

  try {
    const res = await fetch(`${GEMINI}/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const out = await res.json();
    if (!res.ok) {
      /* Pass the provider's own reason through, but never the key or the
         full upstream URL — those end up in client logs and bug reports. */
      const msg = out?.error?.message || 'The AI service refused that.';
      return json({ error: String(msg).replace(/key=[^&\s]+/g, 'key=***') }, res.status === 429 ? 429 : 502);
    }
    const text = out?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ error: 'The AI returned nothing usable.' }, 502);
    return json({ text });
  } catch (e) {
    return json({ error: 'Could not reach the AI service.' }, 502);
  }
});
