// supabase/functions/delete-account/index.ts
// ─────────────────────────────────────────────────────────
// Borrado TOTAL de la cuenta (derecho al olvido). Elimina los datos del
// usuario Y su identidad en auth.users — esto último requiere el service
// role, que SOLO vive aquí en el servidor.
//
// El cliente la invoca con su JWT; la función borra únicamente al usuario
// autenticado (no puede borrar a otros).
//
// ORDEN INNEGOCIABLE: primero los datos (tablas + Storage), y la identidad de
// auth SOLO si todo lo anterior salió bien. Antes se borraba la identidad
// siempre y se devolvía { ok:true, partial:true } cuando algo había fallado —
// un borrado a medias irreversible: sin identidad ya no existe JWT con el que
// reintentar, así que los datos que quedaron atrás se vuelven inalcanzables
// para el propio usuario y la promesa de borrado "permanente" de la política
// de privacidad deja de cumplirse. Es preferible fallar en 500 y que el
// usuario reintente con su sesión todavía viva.
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

// Todas las tablas con datos del usuario. Varias las cubriría el `on delete
// cascade` de auth.users, pero el borrado explícito debe estar completo POR SÍ
// MISMO: si mañana cambia el orden de operaciones (o se deja de borrar la
// identidad, como cuando algo falla), el cascade no corre y esas filas se
// quedan. La lista es la fuente de verdad, no el cascade.
const TABLES = [
  'set_logs', 'body_scans', 'posture_feedback', 'workout_sessions',
  'food_logs', 'weight_entries', 'transform_photos', 'training_plans',
  'user_stats', 'notification_preferences', 'push_tokens', 'ai_usage',
  'coach_memory', 'ai_telemetry', 'ai_content_reports', 'analytics_events',
  'health_profile', 'user_profiles',
];

// Storage NO lo cubre ningún cascade de Postgres: si no se borran aquí, las
// fotos quedan huérfanas para siempre. `list` topa en 100 por página, así que
// hay que paginar; con 1000 fijos, un usuario con más fotos dejaba archivos.
const PAGE = 100;
// Tope de páginas por si `list` nunca devuelve una página corta (bucket raro o
// error del servicio): 500 páginas = 50 000 fotos, muy por encima de lo real.
const MAX_PAGES = 500;

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
  let deletedTables = 0;
  let deletedFiles = 0;

  // 1. Borrar filas de todas las tablas del usuario.
  for (const t of TABLES) {
    const { error } = await admin.from(t).delete().eq('user_id', user.id);
    if (error) { hadError = true; console.error(`delete ${t}:`, error.message); }
    else deletedTables++;
  }

  // 2. Borrar las fotos de transformación del Storage (derecho al olvido).
  try {
    // Se listan TODAS las páginas antes de borrar nada: si se borrara dentro
    // del mismo bucle, cada `remove` correría el contenido bajo el offset y se
    // saltarían archivos silenciosamente.
    const paths: string[] = [];
    let listedAll = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data: files, error: listErr } = await admin.storage
        .from('transform-photos')
        .list(user.id, { limit: PAGE, offset: page * PAGE });
      if (listErr) { hadError = true; console.error('storage list:', listErr.message); break; }
      const batch = files ?? [];
      for (const f of batch as { name: string }[]) paths.push(`${user.id}/${f.name}`);
      if (batch.length < PAGE) { listedAll = true; break; } // página corta = última página
    }
    // Agotar el tope sin llegar a una página corta significa que quedan fotos
    // sin listar: marcarlo como error. Si no, borraríamos la identidad dejando
    // huérfanos — justo lo que este cambio evita.
    if (!listedAll && !hadError) {
      hadError = true;
      console.error('storage list: se alcanzó MAX_PAGES, quedan archivos sin listar');
    }

    // Borrar por lotes del mismo tamaño que la página (el endpoint de `remove`
    // tiene un límite práctico de paths por llamada).
    for (let i = 0; i < paths.length; i += PAGE) {
      const chunk = paths.slice(i, i + PAGE);
      const { data: removed, error: rmErr } = await admin.storage
        .from('transform-photos')
        .remove(chunk);
      if (rmErr) { hadError = true; console.error('storage remove:', rmErr.message); continue; }
      deletedFiles += removed?.length ?? chunk.length;
    }
  } catch (e) {
    hadError = true;
    console.error('storage cleanup:', (e as Error).message);
  }

  // 3. Eliminar la identidad de auth — SOLO si los datos se fueron completos.
  //    Ver la nota de arriba: borrarla con datos atrás es irreversible.
  if (hadError) {
    return json({
      ok: false,
      partial: true,
      error: 'No se pudieron borrar todos tus datos, así que tu cuenta NO fue eliminada ' +
             'para que puedas reintentarlo. Vuelve a intentarlo en unos minutos.',
      deletedTables,
      deletedFiles,
    }, 500);
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) return json({ ok: false, error: 'No se pudo eliminar la cuenta: ' + delErr.message }, 500);

  return json({ ok: true, deletedTables, deletedFiles });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// TODO (legal, NO tocado aquí para no pisar a otro agente): docs/legal/privacy-policy.md
// y docs/legal/delete-account.html afirman que el borrado es "permanente" e
// "irreversible" sin matices. Con este cambio la cuenta ya no se pierde sobre un
// borrado incompleto, pero quedan dos salvedades que la política debería declarar:
//   1. El borrado puede FALLAR y quedar sin efecto (la cuenta sigue viva y hay
//      que reintentar); no es instantáneo ni garantizado al primer intento.
//   2. Copias de seguridad y logs del proveedor (Supabase) pueden retener datos
//      por su propio periodo de retención después del borrado.
// Frase sugerida para reemplazar "eliminación permanente e irreversible":
//   "Al confirmar, eliminamos de forma permanente tus datos y tu cuenta. Si el
//    proceso falla, no se elimina nada y podrás reintentarlo. Copias de
//    seguridad y registros técnicos de nuestro proveedor pueden conservar
//    datos hasta 30 días adicionales antes de su eliminación definitiva."
