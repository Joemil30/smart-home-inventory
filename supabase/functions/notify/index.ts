// Cold Room — family push sender (Supabase Edge Function, Deno).
// Any family phone POSTs { household, title, body, tag } and every
// subscribed device in that household gets a web-push notification.
//
// Deploy (needs the Supabase CLI on a computer, one time):
//   1) npx web-push generate-vapid-keys        # copy the Public + Private
//   2) supabase secrets set VAPID_PUBLIC=... VAPID_PRIVATE=... VAPID_SUBJECT=mailto:you@example.com
//   3) supabase functions deploy notify --no-verify-jwt
//   4) In the app: Setup → Family sync → paste the VAPID *public* key → Enable notifications
//
// Subscriptions live in the same `sync` table (store='push'); no extra schema.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { household, title, body, tag } = await req.json();
    if (!household) return new Response('missing household', { status: 400, headers: cors });

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: subs } = await supa.from('sync')
      .select('id,data').eq('household', household).eq('store', 'push').eq('deleted', false);

    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') || 'mailto:coldroom@example.com',
      Deno.env.get('VAPID_PUBLIC')!, Deno.env.get('VAPID_PRIVATE')!,
    );
    const payload = JSON.stringify({ title: title || 'Cold Room', body: body || '', tag: tag || 'coldroom' });

    await Promise.all((subs || []).map(async (row: { id: string; data: unknown }) => {
      try {
        await webpush.sendNotification(row.data as webpush.PushSubscription, payload);
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {   // subscription gone — prune it
          await supa.from('sync').update({ deleted: true }).match({ household, store: 'push', id: row.id });
        }
      }
    }));
    return new Response(JSON.stringify({ sent: (subs || []).length }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(String(e), { status: 500, headers: cors });
  }
});
