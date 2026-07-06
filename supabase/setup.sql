-- supabase/setup.sql
-- ─────────────────────────────────────────────────────────
-- FUENTE ÚNICA DE VERDAD del esquema de GymUp.
-- Idempotente: puedes ejecutarlo entero en el SQL Editor de Supabase
-- las veces que quieras. Reemplaza a los schema-*.sql y migrations sueltos.
-- ─────────────────────────────────────────────────────────

create extension if not exists "uuid-ossp";

-- Helper: aplica las 4 políticas RLS estándar (con WITH CHECK) a una tabla
-- cuya columna de dueño es user_id. Incluye el GRANT explícito: Supabase
-- NO otorga privilegios a anon/authenticated automáticamente en tablas
-- creadas por SQL crudo (a diferencia del Table Editor), así que sin esto
-- la API devuelve "permission denied" (42501) aunque RLS esté bien.
create or replace function public._apply_owner_rls(tbl text) returns void
language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', tbl);
  execute format('grant select, insert, update, delete on public.%I to anon, authenticated', tbl);
  execute format('drop policy if exists %I on public.%I', tbl||'_select', tbl);
  execute format('drop policy if exists %I on public.%I', tbl||'_insert', tbl);
  execute format('drop policy if exists %I on public.%I', tbl||'_update', tbl);
  execute format('drop policy if exists %I on public.%I', tbl||'_delete', tbl);
  execute format('create policy %I on public.%I for select using (auth.uid() = user_id)', tbl||'_select', tbl);
  execute format('create policy %I on public.%I for insert with check (auth.uid() = user_id)', tbl||'_insert', tbl);
  execute format('create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', tbl||'_update', tbl);
  execute format('create policy %I on public.%I for delete using (auth.uid() = user_id)', tbl||'_delete', tbl);
end $$;

-- ─── PERFIL ──────────────────────────────────────────────
create table if not exists public.user_profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  name text not null,
  age integer not null check (age between 18 and 90),
  weight_kg numeric(5,1) not null check (weight_kg between 30 and 300),
  height_cm numeric(5,1) not null check (height_cm between 130 and 230),
  goal text not null check (goal in ('muscle_gain','fat_loss','performance','endurance')),
  activity_level text not null check (activity_level in ('sedentary','light','moderate','active','very_active')),
  daily_calories integer not null default 2000,
  daily_protein_g integer not null default 150,
  daily_carbs_g integer not null default 200,
  daily_fat_g integer not null default 65,
  current_plan_day integer not null default 0 check (current_plan_day between 0 and 6),
  last_active_date date,
  is_premium boolean not null default false,
  target_weight_kg numeric(5,1),          -- meta de peso (opcional)
  goal_why text,                          -- motivación personal ("el porqué")
  goal_start_weight_kg numeric(5,1),      -- peso al fijar la meta (para % de avance)
  nickname text,                          -- cómo quiere que lo llame la app/el coach
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- Columnas nuevas: idempotentes para bases ya creadas con la versión previa.
alter table if exists public.user_profiles add column if not exists target_weight_kg numeric(5,1);
alter table if exists public.user_profiles add column if not exists goal_why text;
alter table if exists public.user_profiles add column if not exists goal_start_weight_kg numeric(5,1);
alter table if exists public.user_profiles add column if not exists nickname text;
select public._apply_owner_rls('user_profiles');
-- SEGURIDAD DE PAGOS: is_premium NO es editable por el cliente. El helper
-- otorga UPDATE de tabla completa; aquí lo estrechamos a columnas seguras.
-- is_premium solo lo escribe el webhook de RevenueCat (service role).
revoke update on public.user_profiles from anon, authenticated;
grant update (name, nickname, age, weight_kg, height_cm, goal, activity_level,
  daily_calories, daily_protein_g, daily_carbs_g, daily_fat_g,
  current_plan_day, last_active_date, target_weight_kg, goal_why,
  goal_start_weight_kg, updated_at)
  on public.user_profiles to anon, authenticated;

-- ─── PLANES ──────────────────────────────────────────────
create table if not exists public.training_plans (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  week_number integer not null default 1,
  plan_data jsonb not null,
  is_active boolean default true,
  generated_at timestamptz default now()
);
select public._apply_owner_rls('training_plans');

-- ─── COMIDAS ─────────────────────────────────────────────
create table if not exists public.food_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  logged_at timestamptz default now(),
  meal_name text not null,
  food_description text,
  photo_url text,
  calories integer not null default 0,
  protein_g numeric(6,1) not null default 0,
  carbs_g numeric(6,1) not null default 0,
  fat_g numeric(6,1) not null default 0,
  fiber_g numeric(6,1) not null default 0
);
select public._apply_owner_rls('food_logs');

-- ─── SESIONES ────────────────────────────────────────────
create table if not exists public.workout_sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  training_plan_id uuid references public.training_plans(id),
  day_index integer not null,
  started_at timestamptz default now(),
  completed_at timestamptz,
  duration_min integer,
  exercises_completed integer default 0,
  posture_score_avg numeric(4,1)
);
select public._apply_owner_rls('workout_sessions');

-- ─── SERIES (peso × reps) ────────────────────────────────
create table if not exists public.set_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  session_id uuid references public.workout_sessions(id) on delete cascade,
  exercise_name text not null,
  set_number integer not null check (set_number > 0),
  weight_kg numeric(6,2) check (weight_kg >= 0 and weight_kg <= 1000),
  reps integer check (reps >= 0 and reps <= 1000),
  logged_at timestamptz default now()
);
select public._apply_owner_rls('set_logs');
create index if not exists set_logs_user_exercise on public.set_logs(user_id, exercise_name, logged_at desc);

-- ─── POSTURA (reservado) ─────────────────────────────────
create table if not exists public.posture_feedback (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  session_id uuid references public.workout_sessions(id),
  exercise_name text not null,
  score integer not null check (score between 0 and 100),
  corrections jsonb,
  recorded_at timestamptz default now()
);
select public._apply_owner_rls('posture_feedback');

-- ─── STATS / GAMIFICACIÓN ────────────────────────────────
create table if not exists public.user_stats (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  current_streak integer default 0,
  longest_streak integer default 0,
  total_xp integer default 0,
  level integer default 1,
  total_workouts integer default 0,
  total_meals_logged integer default 0,
  total_macro_perfect_days integer default 0,
  total_body_scans integer default 0,
  earned_badges text[] default '{}',
  last_workout_date date,
  streak_freezes integer not null default 1,
  claimed_missions text[] not null default '{}',
  updated_at timestamptz default now()
);
select public._apply_owner_rls('user_stats');

-- ─── PESO ────────────────────────────────────────────────
create table if not exists public.weight_entries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  weight numeric(5,2) not null check (weight between 30 and 300),
  unique(user_id, date)
);
select public._apply_owner_rls('weight_entries');
create index if not exists weight_user_date on public.weight_entries(user_id, date);

-- ─── FOTOS TRANSFORMACIÓN ────────────────────────────────
create table if not exists public.transform_photos (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  uri text not null,
  date date not null,
  note text
);
select public._apply_owner_rls('transform_photos');

-- ─── ESCANEO CORPORAL (sin fotos) ────────────────────────
create table if not exists public.body_scans (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  scanned_at timestamptz default now(),
  overall_score integer check (overall_score between 0 and 100),
  estimated_fat_pct numeric(4,1) check (estimated_fat_pct between 0 and 60),
  estimated_muscle_level text,
  zones jsonb, strengths jsonb, focus_areas jsonb,
  notes text, photos_count integer default 1
);
select public._apply_owner_rls('body_scans');
create index if not exists body_scans_user_date on public.body_scans(user_id, scanned_at desc);

-- ─── PREFERENCIAS DE NOTIFICACIÓN ────────────────────────
create table if not exists public.notification_preferences (
  user_id uuid references auth.users(id) on delete cascade not null primary key,
  workout_days integer[] default '{1,2,3,4,5}',
  wake_up_hour integer default 7,
  workout_hour integer default 18,
  enabled boolean default true,
  updated_at timestamptz default now()
);
select public._apply_owner_rls('notification_preferences');

-- ─── PUSH TOKENS ─────────────────────────────────────────
create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  platform text,
  updated_at timestamptz default now()
);
select public._apply_owner_rls('push_tokens');
create index if not exists push_tokens_user on public.push_tokens(user_id);

-- ─── PERFIL DE SALUD (tamizaje estilo PAR-Q+) ────────────
-- Lesiones, condiciones y banderas rojas: la IA recibe directivas
-- individuales de seguridad en TODO lo que genera. Dato sensible:
-- tabla propia con RLS estricta y borrable con la cuenta.
create table if not exists public.health_profile (
  user_id uuid references auth.users(id) on delete cascade not null primary key,
  parq_chest_pain boolean not null default false,
  parq_dizziness boolean not null default false,
  parq_doctor_restricted boolean not null default false,
  conditions text[] not null default '{}',
  injuries text[] not null default '{}',
  other_note text,
  doctor_cleared boolean not null default false,
  cleared_at timestamptz,   -- cuándo confirmó la autorización (vigencia 12/3 meses)
  risk_level text check (risk_level in ('bajo','moderado','alto')),
  updated_at timestamptz default now()
);
alter table if exists public.health_profile add column if not exists cleared_at timestamptz;
select public._apply_owner_rls('health_profile');

-- ─── MEMORIA DEL COACH IA ────────────────────────────────
-- Hechos duraderos destilados de las conversaciones (lesiones, gustos,
-- horarios, contexto de vida). El usuario puede verlos y borrarlos.
create table if not exists public.coach_memory (
  user_id uuid references auth.users(id) on delete cascade not null primary key,
  facts jsonb not null default '[]',
  updated_at timestamptz default now()
);
select public._apply_owner_rls('coach_memory');

-- ─── OBSERVABILIDAD PROPIA DE IA ─────────────────────────
-- Una fila por llamada de IA: costo exacto, latencia, tokens, feature,
-- turno, contexto de decisión del agente y score de calidad del mensaje.
-- Sin contenido de mensajes (privacidad por diseño).
create table if not exists public.ai_telemetry (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  ts timestamptz default now(),
  feature text not null,
  model text,
  ok boolean not null default true,
  error text,
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  cost_usd numeric(10,6),
  turn_count integer,
  conversation_id text,   -- agrupa llamadas de una misma conversación (ficha técnica)
  decision jsonb,         -- insumos del agente al decidir (incluye context_pressure)
  signals jsonb,          -- señales derivadas post-respuesta (intención, sentimiento, cambio de tema)
  score integer check (score between 0 and 100),
  hallucination boolean,
  score_reason text
);
-- Columnas nuevas: idempotentes para bases que ya crearon la tabla sin ellas.
alter table if exists public.ai_telemetry add column if not exists conversation_id text;
alter table if exists public.ai_telemetry add column if not exists signals jsonb;
select public._apply_owner_rls('ai_telemetry');
create index if not exists ai_telemetry_user_ts on public.ai_telemetry(user_id, ts desc);
create index if not exists ai_telemetry_conv on public.ai_telemetry(user_id, conversation_id);

-- ─── ANALÍTICA CONDUCTUAL (Behavioral Warehouse propio) ──
-- Un evento por fila con capa de identidad completa (anonymous/session/user),
-- pantalla, propiedades y contexto de dispositivo. Ver ANALYTICS.md.
create table if not exists public.analytics_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  anonymous_id text not null,          -- nace pre-registro; une el recorrido completo
  session_id text not null,            -- rota tras 30 min de inactividad
  seq integer,                         -- orden dentro de la sesión
  event text not null,                 -- dominio_accion (snake_case)
  screen text,                         -- ruta expo-router donde ocurrió
  props jsonb,                         -- propiedades del evento
  context jsonb,                       -- device/app snapshot (plataforma, versión, pantalla...)
  client_ts timestamptz not null,      -- hora del dispositivo al ocurrir
  ts timestamptz default now()         -- hora de llegada al servidor
);
select public._apply_owner_rls('analytics_events');
create index if not exists analytics_user_ts on public.analytics_events(user_id, client_ts desc);
create index if not exists analytics_user_event on public.analytics_events(user_id, event);
create index if not exists analytics_session on public.analytics_events(user_id, session_id, seq);

-- ─── FEATURE STORE: RASGOS POR USUARIO (L8) ──────────────
-- Vista calculada sobre eventos + dominio: hábitos, engagement y riesgo de
-- churn por usuario. security_invoker ⇒ cada quien ve SOLO su fila (RLS de
-- las tablas base). Base de segmentación y de los futuros modelos.
create or replace view public.v_user_traits
with (security_invoker = true) as
with base as (
  select
    p.user_id,
    p.created_at as first_seen,
    (select count(distinct e.session_id) from public.analytics_events e
      where e.user_id = p.user_id and e.client_ts > now() - interval '7 days') as sessions_7d,
    (select round(avg((e.props->>'duration_sec')::numeric) / 60, 1) from public.analytics_events e
      where e.user_id = p.user_id and e.event = 'session_ended'
        and e.client_ts > now() - interval '30 days') as avg_session_min_30d,
    (select count(*) from public.workout_sessions s
      where s.user_id = p.user_id and s.completed_at is not null
        and s.started_at > now() - interval '7 days') as workouts_7d,
    (select count(*) from public.workout_sessions s
      where s.user_id = p.user_id and s.completed_at is not null
        and s.started_at > now() - interval '30 days') as workouts_30d,
    (select mode() within group (order by extract(hour from s.started_at))
      from public.workout_sessions s
      where s.user_id = p.user_id and s.completed_at is not null) as habit_hour,
    (select mode() within group (order by extract(isodow from s.started_at))
      from public.workout_sessions s
      where s.user_id = p.user_id and s.completed_at is not null) as habit_dow,
    (select count(distinct f.logged_at::date) from public.food_logs f
      where f.user_id = p.user_id and f.logged_at > now() - interval '7 days') as food_days_7d,
    (select count(*) from public.ai_telemetry t
      where t.user_id = p.user_id and t.feature = 'coach_chat'
        and t.ts > now() - interval '7 days') as coach_msgs_7d,
    (select count(*) from public.analytics_events e
      where e.user_id = p.user_id and e.event = 'paywall_viewed'
        and e.client_ts > now() - interval '30 days') as paywall_views_30d,
    (select count(*) from public.analytics_events e
      where e.user_id = p.user_id and e.event = 'workout_abandoned'
        and e.client_ts > now() - interval '30 days') as workouts_abandoned_30d,
    (select max(s.started_at) from public.workout_sessions s
      where s.user_id = p.user_id and s.completed_at is not null) as last_workout_at
  from public.user_profiles p
)
select b.*,
  case when b.last_workout_at is null then null
       else extract(day from now() - b.last_workout_at)::int end as days_since_last_workout,
  case
    when b.last_workout_at is null then 'nuevo'
    when now() - b.last_workout_at >= interval '7 days' then 'alto'
    when now() - b.last_workout_at >= interval '4 days' and b.workouts_30d >= 3 then 'medio'
    else 'bajo'
  end as churn_risk,
  least(100, b.workouts_7d * 25 + b.food_days_7d * 8 + b.coach_msgs_7d * 4 + b.sessions_7d * 3)::int as engagement_score
from base b;
grant select on public.v_user_traits to anon, authenticated;

-- ─── VISTAS DE OPERADOR (cross-usuario, SIN grant al cliente) ─────────────
-- Solo consultables desde el SQL Editor / service role. Son el backbone de
-- retención estilo Netflix: cohortes, actividad diaria y power-user curve.

-- Actividad diaria por usuario (base de retención y rachas de producto).
create or replace view public.v_daily_activity as
select user_id, client_ts::date as day,
  count(*) filter (where event = 'workout_completed') as workouts,
  count(*) filter (where event = 'food_added') as foods,
  count(*) filter (where event = 'coach_message_sent') as coach_msgs,
  count(distinct session_id) as sessions
from public.analytics_events
group by 1, 2;

-- Retención por cohorte semanal de registro: % activo en D1 / D7 / D30.
create or replace view public.v_cohort_retention as
with cohort as (
  select user_id, min(client_ts)::date as signup_day
  from public.analytics_events where event = 'onboarding_completed' group by 1
),
activity as (select distinct user_id, client_ts::date as day from public.analytics_events)
select date_trunc('week', c.signup_day)::date as cohort_week,
  count(distinct c.user_id) as users,
  round(100.0 * count(distinct a1.user_id) / nullif(count(distinct c.user_id), 0), 1) as d1_pct,
  round(100.0 * count(distinct a7.user_id) / nullif(count(distinct c.user_id), 0), 1) as d7_pct,
  round(100.0 * count(distinct a30.user_id) / nullif(count(distinct c.user_id), 0), 1) as d30_pct
from cohort c
left join activity a1  on a1.user_id = c.user_id and a1.day = c.signup_day + 1
left join activity a7  on a7.user_id = c.user_id and a7.day between c.signup_day + 7  and c.signup_day + 8
left join activity a30 on a30.user_id = c.user_id and a30.day between c.signup_day + 30 and c.signup_day + 32
group by 1 order by 1 desc;

-- Power-user curve (la "L28" de Facebook): distribución de días activos/mes.
create or replace view public.v_power_curve as
select active_days, count(*) as users
from (
  select user_id, count(distinct client_ts::date) as active_days
  from public.analytics_events
  where client_ts > now() - interval '28 days'
  group by 1
) t
group by 1 order by 1;

-- ─── USO DE IA (rate limit por feature) ──────────────────
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null default current_date,
  feature text not null default 'general',
  count integer not null default 0,
  primary key (user_id, date, feature)
);
alter table public.ai_usage enable row level security; -- sin políticas: solo la RPC

create or replace function public.increment_ai_usage(p_user_id uuid, p_feature text, p_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare current_count integer;
begin
  insert into public.ai_usage (user_id, date, feature, count)
  values (p_user_id, current_date, p_feature, 1)
  on conflict (user_id, date, feature)
  do update set count = public.ai_usage.count + 1
  returning count into current_count;
  return current_count <= p_limit;
end $$;
grant execute on function public.increment_ai_usage(uuid, text, integer) to authenticated;

-- ─── STORAGE: fotos de transformación (privado) ──────────
insert into storage.buckets (id, name, public)
values ('transform-photos', 'transform-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "tp_upload" on storage.objects;
drop policy if exists "tp_read" on storage.objects;
drop policy if exists "tp_delete" on storage.objects;
create policy "tp_upload" on storage.objects for insert
  with check (bucket_id = 'transform-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "tp_read" on storage.objects for select
  using (bucket_id = 'transform-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "tp_delete" on storage.objects for delete
  using (bucket_id = 'transform-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- ─── updated_at automático ───────────────────────────────
create or replace function public.handle_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;

drop trigger if exists set_updated_at on public.user_profiles;
create trigger set_updated_at before update on public.user_profiles
  for each row execute function public.handle_updated_at();

-- ─── Índices de consulta frecuente ───────────────────────
create index if not exists food_logs_user_date on public.food_logs(user_id, logged_at);
create index if not exists sessions_user_date on public.workout_sessions(user_id, started_at);
create index if not exists plans_user_active on public.training_plans(user_id, is_active);
