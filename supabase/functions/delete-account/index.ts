// supabase/functions/delete-account/index.ts
// ─────────────────────────────────────────────────────────
// Borrado TOTAL de la cuenta (derecho al olvido). Elimina los datos del
// usuario Y su identidad en auth.users — esto último requiere el service
// role, que SOLO vive aquí en el servidor.
//
// El cliente la invoca con su JWT; la función borra únicamente al usuario
// autenticado (no puede borrar a otros).
//
// DESPLIEGUE:
//   supabase functions deploy delete-account
//   (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya están disponibles como
//    secretos por defecto en las Edge Functions del proyecto.)
// ─────────────────────────────────────────────────────────

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TABLES = [
  'set_logs', 'body_scans', 'posture_feedback', 'workout_sessions',
  'food_logs', 'weight_entries', 'transform_photos', 'training_plans',
  'user_stats', 'notification_preferences', 'push_tokens', 'ai_usage',
  'coach_memory', 'ai_telemetry', 'analytics_events', 'health_profile', 'user_profiles',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Falta autorización' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;

  // Cliente con el JWT del usuario solo para identificar quién llama.
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'No autorizado' }, 401);

  // Cliente admin (service role) para borrar datos y la identidad.
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let hadError = false;

  // 1. Borrar filas de todas las tablas del usuario.
  for (const t of TABLES) {
    const { error } = await admin.from(t).delete().eq('user_id', user.id);
    if (error) { hadError = true; console.error(`delete ${t}:`, error.message); }
  }

  // 2. Borrar las fotos de transformación del Storage (derecho al olvido).
  try {
    const { data: files } = await admin.storage
      .from('transform-photos')
      .list(user.id, { limit: 1000 });
    if (files && files.length > 0) {
      const paths = files.map((f: { name: string }) => `${user.id}/${f.name}`);
      const { error: rmErr } = await admin.storage.from('transform-photos').remove(paths);
      if (rmErr) { hadError = true; console.error('storage remove:', rmErr.message); }
    }
  } catch (e) {
    hadError = true;
    console.error('storage cleanup:', (e as Error).message);
  }

  // 3. Eliminar la identidad de auth.
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) return json({ error: 'No se pudo eliminar la cuenta: ' + delErr.message }, 500);

  // Si algún borrado de datos falló, informarlo (la cuenta sí se eliminó).
  return json({ ok: true, partial: hadError });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
