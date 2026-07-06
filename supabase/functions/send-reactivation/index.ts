// supabase/functions/send-reactivation/index.ts
// ─────────────────────────────────────────────────────────
// Envía un push de reactivación a quienes llevan 3+ días sin abrir la app.
// Pensada para correr en un CRON (no es un endpoint para clientes).
//
// DESPLIEGUE:
//   supabase functions deploy send-reactivation
// PROGRAMAR (pg_cron + extensión pg_net, o un scheduler externo). Ejemplo
// con pg_cron llamando a la función vía http cada día a las 18:00:
//   select cron.schedule('reactivation','0 18 * * *', $$
//     select net.http_post(
//       url := '<project>.functions.supabase.co/send-reactivation',
//       headers := jsonb_build_object('Authorization','Bearer <SERVICE_ROLE>')
//     ); $$);
// ─────────────────────────────────────────────────────────

import { createClient } from 'jsr:@supabase/supabase-js@2';

const MESSAGES = [
  { title: '¿Qué pasó? 👀', body: 'Llevas días sin entrenar. Tu versión de hace una semana te está esperando.' },
  { title: 'El sofá va ganando 🛋️', body: '3-0. ¿Lo dejas así o entras hoy aunque sea 15 minutos?' },
  { title: 'Tu racha te extraña 🔥', body: 'Vuelve hoy y la retomamos. No tienes que querer; solo hacerlo.' },
];

Deno.serve(async (req) => {
  // Autorización mínima: exige el service role (lo manda el cron).
  const auth = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  // Comparación exacta del bearer (no substring).
  if (auth !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

  // Usuarios inactivos 3+ días.
  const cutoff = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];
  const { data: profiles, error } = await admin
    .from('user_profiles')
    .select('user_id, name, last_active_date')
    .or(`last_active_date.lte.${cutoff},last_active_date.is.null`)
    .limit(1000);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const userIds = (profiles ?? []).map((p: any) => p.user_id);
  if (userIds.length === 0) return json({ sent: 0 });

  const { data: tokens } = await admin
    .from('push_tokens')
    .select('user_id, token')
    .in('user_id', userIds);

  // Construir mensajes Expo (un mensaje aleatorio por token).
  const messages = (tokens ?? []).map((t: any) => {
    const m = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
    return { to: t.token, sound: 'default', title: m.title, body: m.body };
  });
  if (messages.length === 0) return json({ sent: 0 });

  // Expo acepta lotes de hasta 100.
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (res.ok) sent += batch.length;
    else console.error('Expo push error:', await res.text());
  }

  return json({ sent });
});

function json(obj: unknown): Response {
  return new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } });
}
