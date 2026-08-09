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
  -- Sexo biológico: sin él, Mifflin-St Jeor usaba SIEMPRE la constante masculina
  -- (+5), lo que da ~166 kcal/día de error basal en mujeres y contamina macros,
  -- déficit y superávit. 'unspecified' usa el punto medio (-78) para acotar ese
  -- error a ±83 kcal en quien prefiere no decirlo.
  sex text not null default 'unspecified' check (sex in ('male','female','unspecified')),
  goal text not null check (goal in ('muscle_gain','fat_loss','performance','endurance')),
  activity_level text not null check (activity_level in ('sedentary','light','moderate','active','very_active')),
  training_experience text not null default 'principiante' check (training_experience in ('principiante','intermedio','avanzado')),
  days_per_week integer not null default 3 check (days_per_week between 1 and 7),
  equipment text not null default 'gym' check (equipment in ('gym','casa_basico','casa_sin_equipo')),
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
alter table if exists public.user_profiles add column if not exists training_experience text not null default 'principiante';
alter table if exists public.user_profiles add column if not exists days_per_week integer not null default 3;
alter table if exists public.user_profiles add column if not exists equipment text not null default 'gym';
-- is_premium está declarada en el CREATE de arriba, pero la tabla ya existía en
-- producción cuando se agregó, así que ese CREATE fue un no-op y la columna
-- NUNCA se creó. Consecuencia real: el select de ai-proxy fallaba, `profile`
-- quedaba null y `profile?.is_premium === true` daba false PARA TODOS — es
-- decir, un usuario que pagara seguía recibiendo 402 en las funciones premium.
alter table if exists public.user_profiles add column if not exists is_premium boolean not null default false;
alter table if exists public.user_profiles add column if not exists sex text not null default 'unspecified';
-- El CHECK va aparte: "add constraint" no tiene "if not exists", así que
-- atrapamos el duplicado para que el script siga siendo re-ejecutable.
do $$
begin
  alter table public.user_profiles
    add constraint user_profiles_sex_check check (sex in ('male','female','unspecified'));
exception when duplicate_object then null;
end $$;
select public._apply_owner_rls('user_profiles');
-- SEGURIDAD DE PAGOS: is_premium NO es editable por el cliente. El helper
-- otorga UPDATE de tabla completa; aquí lo estrechamos a columnas seguras.
-- is_premium solo lo escribe el webhook de RevenueCat (service role).
revoke update on public.user_profiles from anon, authenticated;
-- user_id incluida: el upsert de onboarding.tsx (onConflict: 'user_id') dispara la
-- rama UPDATE con user_id en el SET aunque el valor no cambie — sin permiso sobre esa
-- columna, Postgres devuelve 42501 "permission denied" en cualquier reintento de
-- onboarding sobre un perfil ya existente. La política WITH CHECK (auth.uid() = user_id)
-- ya impide reasignar el perfil a otro usuario, así que otorgar UPDATE aquí es seguro.
grant update (user_id, name, nickname, age, sex, weight_kg, height_cm, goal, activity_level,
  training_experience, days_per_week, equipment,
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
  generated_at timestamptz default now(),
  parent_plan_id uuid references public.training_plans(id),
  change_reason jsonb not null default '{}'::jsonb,
  replaced_at timestamptz
);
alter table public.training_plans add column if not exists parent_plan_id uuid references public.training_plans(id);
alter table public.training_plans add column if not exists change_reason jsonb not null default '{}'::jsonb;
alter table public.training_plans add column if not exists replaced_at timestamptz;
-- Sanea estados heredados antes de imponer la invariante: un solo plan activo.
with ranked as (
  select id, row_number() over (partition by user_id order by generated_at desc, id desc) as rn
  from public.training_plans where is_active
)
update public.training_plans p set is_active = false, replaced_at = coalesce(p.replaced_at, now())
from ranked r where p.id = r.id and r.rn > 1;
create unique index if not exists one_active_training_plan_per_user
  on public.training_plans(user_id) where is_active;
select public._apply_owner_rls('training_plans');

create or replace function public.activate_training_plan(p_plan_data jsonb, p_change_reason jsonb default '{}'::jsonb)
returns setof public.training_plans
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_parent uuid;
  v_new uuid;
  v_week integer := 1;
begin
  if v_uid is null then raise exception 'Se requiere autenticación'; end if;
  if jsonb_typeof(p_plan_data) <> 'object' or jsonb_array_length(coalesce(p_plan_data->'days', '[]'::jsonb)) <> 7 then
    raise exception 'El plan debe contener exactamente 7 días';
  end if;
  select p.id, coalesce(p.week_number, 0) + 1 into v_parent, v_week
  from public.training_plans p where p.user_id = v_uid and p.is_active
  order by p.generated_at desc limit 1 for update;

  insert into public.training_plans(user_id, week_number, plan_data, is_active, parent_plan_id, change_reason)
  values(v_uid, coalesce(v_week, 1), p_plan_data, false, v_parent, coalesce(p_change_reason, '{}'::jsonb))
  returning id into v_new;
  update public.training_plans set is_active = false, replaced_at = now()
  where user_id = v_uid and is_active;
  update public.training_plans set is_active = true, replaced_at = null where id = v_new;
  update public.user_profiles set current_plan_day = 0, updated_at = now() where user_id = v_uid;
  return query select p.* from public.training_plans p where p.id = v_new;
end $$;
grant execute on function public.activate_training_plan(jsonb, jsonb) to authenticated;

create or replace function public.restore_previous_training_plan()
returns setof public.training_plans
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_current uuid;
  v_previous uuid;
begin
  if v_uid is null then raise exception 'Se requiere autenticación'; end if;
  select p.id, p.parent_plan_id into v_current, v_previous
  from public.training_plans p where p.user_id = v_uid and p.is_active
  order by p.generated_at desc limit 1 for update;
  if v_current is null then raise exception 'No hay plan activo'; end if;
  if v_previous is null then
    select p.id into v_previous from public.training_plans p
    where p.user_id = v_uid and p.id <> v_current
    order by p.generated_at desc limit 1;
  end if;
  if v_previous is null then raise exception 'No hay un plan anterior para restaurar'; end if;
  update public.training_plans set is_active = false, replaced_at = now() where id = v_current;
  update public.training_plans set is_active = true, replaced_at = null where id = v_previous and user_id = v_uid;
  update public.user_profiles set current_plan_day = 0, updated_at = now() where user_id = v_uid;
  return query select p.* from public.training_plans p where p.id = v_previous;
end $$;
grant execute on function public.restore_previous_training_plan() to authenticated;

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
  fiber_g numeric(6,1) not null default 0,
  xp_credited_at timestamptz
);
alter table public.food_logs add column if not exists xp_credited_at timestamptz;
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
  posture_score_avg numeric(4,1),
  client_session_key uuid
);
-- Marca de que esta sesión YA pagó su XP. Es la evidencia que convierte
-- "el cliente dice que entrenó" en "existe una sesión completada, suya, que
-- todavía no se ha cobrado". Sin esto, apply_workout_stats sumaba XP en CADA
-- llamada: bastaba invocarla en bucle para subir de nivel sin entrenar.
alter table public.workout_sessions add column if not exists xp_credited_at timestamptz;
alter table public.workout_sessions add column if not exists client_session_key uuid;
create unique index if not exists workout_session_idempotency
  on public.workout_sessions(user_id, client_session_key)
  where client_session_key is not null;

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
  rir numeric(3,1) check (rir between 0 and 10),
  logged_at timestamptz default now()
);
select public._apply_owner_rls('set_logs');
create index if not exists set_logs_user_exercise on public.set_logs(user_id, exercise_name, logged_at desc);
alter table public.set_logs add column if not exists rir numeric(3,1) check (rir between 0 and 10);
-- Índice único de (sesión, ejercicio, nº de serie) RETIRADO: rechazaba series
-- legítimas. Ver la explicación completa en
-- supabase/migrations/0007_world_class_safety_integrity.sql.

-- Estado subjetivo previo a entrenar. No reemplaza el tamizaje clínico: sirve
-- para distinguir una meseta real de fatiga, poco tiempo o un mal día aislado.
create table if not exists public.workout_readiness (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  client_session_key uuid not null,
  energy integer check (energy between 1 and 5),
  sleep_quality integer check (sleep_quality between 1 and 5),
  soreness integer check (soreness between 1 and 5),
  stress integer check (stress between 1 and 5),
  available_minutes integer check (available_minutes between 5 and 240),
  pain_new boolean not null default false,
  recorded_at timestamptz not null default now(),
  unique(user_id, client_session_key)
);
select public._apply_owner_rls('workout_readiness');
create index if not exists readiness_user_date on public.workout_readiness(user_id, recorded_at desc);

-- Toda referencia sensible debe pertenecer al mismo usuario de la fila. RLS
-- protege la fila destino, pero una FK por sí sola no impide enlazar el UUID de
-- otro usuario si ese UUID se filtró por cualquier vía.
create or replace function public._enforce_owned_training_reference()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.training_plan_id is not null and not exists (
    select 1 from public.training_plans p
    where p.id = new.training_plan_id and p.user_id = new.user_id
  ) then
    raise exception 'El plan no pertenece al usuario de la sesión';
  end if;
  return new;
end $$;

drop trigger if exists workout_session_owned_plan on public.workout_sessions;
create trigger workout_session_owned_plan before insert or update of user_id, training_plan_id
on public.workout_sessions for each row execute function public._enforce_owned_training_reference();

create or replace function public._enforce_owned_session_reference()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.session_id is not null and not exists (
    select 1 from public.workout_sessions w
    where w.id = new.session_id and w.user_id = new.user_id
  ) then
    raise exception 'La sesión no pertenece al usuario de la fila';
  end if;
  return new;
end $$;

drop trigger if exists set_log_owned_session on public.set_logs;
create trigger set_log_owned_session before insert or update of user_id, session_id
on public.set_logs for each row execute function public._enforce_owned_session_reference();

-- Cierre atómico e idempotente: o quedan sesión Y series, o no queda ninguna.
create or replace function public.complete_workout_session(
  p_client_session_key uuid,
  p_training_plan_id uuid,
  p_day_index integer,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_duration_min integer,
  p_sets jsonb
)
returns table (
  session_id uuid,
  exercises_completed integer,
  sets_saved integer,
  already_completed boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_session uuid;
  v_exercises integer;
  v_sets integer;
  v_duration integer;
begin
  if v_uid is null then raise exception 'Se requiere autenticación'; end if;
  if p_client_session_key is null then raise exception 'Falta la clave idempotente'; end if;
  if p_day_index not between 0 and 6 then raise exception 'Día de plan inválido'; end if;
  if p_started_at is null or p_completed_at is null or p_completed_at < p_started_at then
    raise exception 'Rango temporal inválido';
  end if;
  if p_completed_at > now() + interval '10 minutes' then raise exception 'Fecha de cierre futura'; end if;
  if p_started_at < p_completed_at - interval '24 hours' then raise exception 'Sesión demasiado extensa'; end if;
  v_duration := greatest(1, least(1440, floor(extract(epoch from (p_completed_at - p_started_at)) / 60)::integer));
  if jsonb_typeof(p_sets) <> 'array' or jsonb_array_length(p_sets) = 0 then
    raise exception 'La sesión necesita al menos una serie real';
  end if;
  if not exists (
    select 1 from public.training_plans p
    where p.id = p_training_plan_id and p.user_id = v_uid
  ) then raise exception 'Plan inexistente o ajeno'; end if;

  -- Serializa dos requests simultáneos con la misma clave. Sin este cerrojo la
  -- unicidad evitaba duplicados, pero uno de los dos requests fallaba en vez de
  -- recibir la respuesta idempotente de la sesión ya creada.
  perform pg_advisory_xact_lock(hashtextextended(p_client_session_key::text, 0));
  select w.id into v_session from public.workout_sessions w
  where w.user_id = v_uid and w.client_session_key = p_client_session_key;
  if v_session is not null then
    select count(*), count(distinct l.exercise_name)
      into v_sets, v_exercises from public.set_logs l where l.session_id = v_session;
    return query select v_session, v_exercises, v_sets, true;
    return;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_sets) as x(
      exercise_name text, set_number integer, weight_kg numeric, reps integer, rir numeric
    )
    where nullif(btrim(x.exercise_name), '') is null
       or length(x.exercise_name) > 200
       or x.set_number is null or x.set_number not between 1 and 100
       or x.reps is null or x.reps not between 1 and 1000
       or (x.weight_kg is not null and x.weight_kg not between 0 and 1000)
       or (x.rir is not null and x.rir not between 0 and 10)
  ) then raise exception 'Hay una serie inválida'; end if;

  select count(distinct btrim(x.exercise_name)), count(*) into v_exercises, v_sets
  from jsonb_to_recordset(p_sets) as x(exercise_name text);

  insert into public.workout_sessions (
    user_id, training_plan_id, day_index, started_at, completed_at,
    duration_min, exercises_completed, client_session_key
  ) values (
    v_uid, p_training_plan_id, p_day_index, p_started_at, p_completed_at,
    v_duration, v_exercises, p_client_session_key
  ) returning id into v_session;

  insert into public.set_logs (
    user_id, session_id, exercise_name, set_number, weight_kg, reps, rir, logged_at
  )
  select v_uid, v_session, btrim(x.exercise_name), x.set_number,
         x.weight_kg, x.reps, x.rir, p_completed_at
  from jsonb_to_recordset(p_sets) as x(
    exercise_name text, set_number integer, weight_kg numeric, reps integer, rir numeric
  );

  return query select v_session, v_exercises, v_sets, false;
end $$;
grant execute on function public.complete_workout_session(uuid, uuid, integer, timestamptz, timestamptz, integer, jsonb) to authenticated;

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

-- ⚠️ Las dos columnas de abajo se agregaron DESPUÉS de que la tabla ya existía
-- en producción. Declararlas arriba no basta: `create table if not exists` es
-- un no-op sobre una tabla existente, así que en producción nunca aparecieron
-- y apply_workout_stats reventaba en runtime con "column s.streak_freezes does
-- not exist" — el usuario terminaba su entrenamiento y no recibía XP ni racha,
-- en silencio, porque el cliente degrada sin romper.
-- Toda columna nueva sobre una tabla que ya existe necesita su ALTER idempotente.
alter table public.user_stats add column if not exists streak_freezes integer not null default 1;
alter table public.user_stats add column if not exists claimed_missions text[] not null default '{}';

select public._apply_owner_rls('user_stats');
-- INTEGRIDAD DE LA GAMIFICACIÓN: el helper otorga INSERT/UPDATE de tabla
-- completa, así que un cliente modificado podía escribirse XP, nivel, racha y
-- badges a voluntad. Los "resultados demostrables" son la promesa central del
-- producto: si el propio usuario los puede falsificar, no valen nada. El
-- cliente pasa a SOLO LEER sus stats; la única vía de escritura es la RPC
-- apply_workout_stats, que recalcula todo del lado del servidor.
-- DELETE se conserva: el borrado de cuenta (profile.tsx y la Edge Function
-- delete-account) elimina esta fila con el JWT del propio usuario.
revoke insert, update on public.user_stats from anon, authenticated;


-- ─── CATÁLOGO DE INSIGNIAS (FUENTE DE VERDAD) ────────────
-- Antes las condiciones de cada badge vivían SOLO en lib/streaks.ts y el
-- servidor hacía unión ciega de lo que el cliente mandara en p_badges: un
-- cliente modificado se auto-otorgaba cualquier insignia. Ahora la condición
-- vive aquí y el servidor la comprueba contra las stats reales.
--
-- ⚠️ ESPEJO DE lib/streaks.ts → BADGES. Los textos (emoji/título/descripción)
-- siguen en el cliente porque son de presentación; lo que NO puede divergir es
-- (id, métrica, umbral, xp). Si agregas un badge, tócalo en los dos lados.
create table if not exists public.badge_catalog (
  id      text primary key,
  metric  text not null check (metric in ('streak', 'meals', 'macro_days', 'body_scans', 'sessions')),
  threshold integer not null check (threshold > 0),
  xp      integer not null check (xp >= 0)
);

insert into public.badge_catalog (id, metric, threshold, xp) values
  ('streak_3',    'streak',     3,   50),
  ('streak_7',    'streak',     7,   150),
  ('streak_14',   'streak',     14,  300),
  ('streak_30',   'streak',     30,  750),
  ('streak_100',  'streak',     100, 3000),
  ('meals_1',     'meals',      1,   30),
  ('meals_10',    'meals',      10,  100),
  ('meals_50',    'meals',      50,  400),
  ('macro_day_1', 'macro_days', 1,   80),
  ('macro_day_7', 'macro_days', 7,   300),
  ('sessions_1',  'sessions',   1,   30),
  ('sessions_10', 'sessions',   10,  200),
  ('sessions_50', 'sessions',   50,  800)
on conflict (id) do update
  set metric = excluded.metric, threshold = excluded.threshold, xp = excluded.xp;

-- Insignias por ESCANEARSE EL CUERPO retiradas (60 XP por el primero, 200 por
-- el cuarto). Premiaban mirarse, no entrenar ni comer mejor, y eran refuerzo
-- directo de la vigilancia corporal compulsiva — lo mismo que la app le
-- prohíbe a la IA en cuanto alguien declara un trastorno alimentario. No se
-- esconden solo para ese perfil: no son buena idea para nadie.
-- Las ya concedidas se dejan en earned_badges de quien las tenga: quitarle
-- XP a alguien por una decisión nuestra sería peor que el problema.
delete from public.badge_catalog where id in ('body_scan_1', 'body_scan_4');
-- Y la misión 'hazte 1 análisis corporal', por lo mismo. Los builds antiguos
-- que la pidan recibirán 'unknown_mission' y no la mostrarán: es la única de
-- las tres viejas que empujaba a una función de pago disfrazada de meta.
delete from public.mission_catalog where id = 'w_scan1';

alter table public.badge_catalog enable row level security;
drop policy if exists badge_catalog_read on public.badge_catalog;
create policy badge_catalog_read on public.badge_catalog for select to authenticated using (true);
revoke insert, update, delete on public.badge_catalog from anon, authenticated;

-- ─── CATÁLOGO DE MISIONES SEMANALES ──────────────────────
-- ⚠️ ESPEJO de WEEKLY_MISSIONS en lib/missions.ts (id, tipo, meta, xp).
create table if not exists public.mission_catalog (
  id     text primary key,
  kind   text not null,
  target integer not null check (target > 0),
  xp     integer not null check (xp >= 0)
);

-- El CHECK va aparte del create table porque `create table if not exists` NO
-- toca una tabla que ya existe: al añadir los tipos nuevos, la restricción
-- vieja seguía en producción y rechazaba las misiones nuevas con un 23514.
-- Los tres primeros tipos son los de las apps ya instaladas (ver abajo).
alter table public.mission_catalog drop constraint if exists mission_catalog_kind_check;
alter table public.mission_catalog add constraint mission_catalog_kind_check
  check (kind in ('workouts', 'meals', 'body_scans',
                  'planned_workouts', 'protein_days', 'rest_day'));

-- Las tres primeras son las VIEJAS. Se quedan a propósito: las apps ya
-- instaladas las siguen pidiendo, y borrarlas del catálogo les respondería
-- 'unknown_mission' — es decir, les quitaría una misión que ya se estaban
-- ganando. Desaparecen solas cuando esos builds se actualicen.
--
-- Las nuevas dejan de premiar el USO de la app (registra 10 comidas, hazte un
-- análisis corporal — este último además empujaba a una función de pago
-- disfrazada de meta) y premian entrenar, comer y descansar.
insert into public.mission_catalog (id, kind, target, xp) values
  ('w_workouts3', 'workouts',         3,  120),
  ('w_meals10',   'meals',            10, 90),
  -- El target de 'planned_workouts' lo sobrescribe el servidor con el plan
  -- real del usuario; el 3 de aquí es solo un respaldo legible.
  ('w_planned',   'planned_workouts', 3,  120),
  ('w_protein3',  'protein_days',     3,  90),
  ('w_rest',      'rest_day',         1,  60)
on conflict (id) do update
  set kind = excluded.kind, target = excluded.target, xp = excluded.xp;

alter table public.mission_catalog enable row level security;
drop policy if exists mission_catalog_read on public.mission_catalog;
create policy mission_catalog_read on public.mission_catalog for select to authenticated using (true);
revoke insert, update, delete on public.mission_catalog from anon, authenticated;

-- ─── MARGEN DE RACHA SEGÚN EL PLAN ───────────────────────
-- Cuántos días seguidos SIN entrenar caben antes de romper la racha.
--
-- Estaba fijo en 2. Un plan de 3 días/semana tiene huecos programados de 3
-- días, así que la app rompía la racha de alguien por descansar el día que
-- ella misma le mandó descansar. Eso no mide constancia: mide suerte con el
-- calendario, y castiga justo la conducta que el plan pide.
--
-- Se deriva del plan activo: la racha se juzga contra las sesiones
-- PROGRAMADAS. El plan es cíclico (7 días), así que la racha de descansos se
-- busca sobre el ciclo duplicado para que un hueco que cruza el domingo
-- cuente igual que uno a mitad de semana.
--
-- Cotas: mínimo 2 (nunca más estricto que antes) y máximo 6 (un plan
-- degenerado con 6 días de descanso no puede convertir la racha en algo que
-- no se rompe nunca).
-- ¿Cuántos días de ENTRENO programa el plan activo? Es el objetivo de la
-- misión de adherencia: "completa lo que TU plan programó" no puede ser un
-- número fijo, porque a quien entrena 2 días le pediría el doble de lo suyo y
-- a quien entrena 6 le regalaría la misión a mitad de semana.
create or replace function public._planned_workout_days(p_uid uuid)
returns integer
language sql stable security definer set search_path = public as $$
  -- nullif es imprescindible: count(*) sobre un plan inexistente devuelve 0,
  -- NO null, así que sin esto el coalesce nunca entraba y el objetivo caía a
  -- 1 entrenamiento — la misión de adherencia quedaba regalada para todo el
  -- que no tuviera plan.
  select greatest(2, least(7, coalesce(nullif((
    select count(*)
    from jsonb_array_elements((
      select p.plan_data -> 'days'
      from public.training_plans p
      where p.user_id = p_uid and p.is_active
      order by p.generated_at desc
      limit 1
    )) d
    where d ->> 'type' = 'workout'
  ), 0), 3)::integer));
$$;
revoke all on function public._planned_workout_days(uuid) from public, anon, authenticated;

-- Parte pura: recibe el array de días y devuelve el margen. Separada de la
-- lectura del plan para poder probarla con planes reales sin inventar
-- usuarios en auth.users.
create or replace function public._max_rest_gap_days(p_dias jsonb)
returns integer
language plpgsql immutable set search_path = public as $$
declare
  v_n integer;
  v_i integer;
  v_run integer := 0;
  v_max integer := 0;
begin
  if p_dias is null or jsonb_typeof(p_dias) <> 'array' then
    return 2; -- sin plan que consultar, el comportamiento de siempre
  end if;

  v_n := jsonb_array_length(p_dias);
  if v_n = 0 then
    return 2;
  end if;

  -- Dos vueltas al ciclo para capturar huecos que cruzan el fin del plan.
  for v_i in 0 .. (v_n * 2 - 1) loop
    if coalesce(p_dias -> (v_i % v_n) ->> 'type', 'rest') = 'workout' then
      v_run := 0;
    else
      v_run := v_run + 1;
      if v_run > v_max then v_max := v_run; end if;
    end if;
  end loop;

  -- Un plan sin ningún día de entrenamiento daría v_max = 2n: la cota lo corta.
  return greatest(2, least(6, v_max + 1));
end;
$$;

create or replace function public._max_rest_gap(p_uid uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select public._max_rest_gap_days((
    select p.plan_data -> 'days'
    from public.training_plans p
    where p.user_id = p_uid and p.is_active
    order by p.generated_at desc
    limit 1
  ));
$$;
-- OJO: hay que revocar a PUBLIC, no solo a anon/authenticated. Postgres
-- concede EXECUTE a PUBLIC por defecto en toda función nueva, así que
-- revocar solo a los roles no quitaba nada: estas son SECURITY DEFINER y
-- aceptan un user_id, o sea que cualquiera podía consultar el plan de otro.
revoke all on function public._max_rest_gap(uuid) from public, anon, authenticated;
revoke all on function public._max_rest_gap_days(jsonb) from public, anon, authenticated;

-- Devuelve TODAS las insignias que corresponden a unas stats dadas. Es pura:
-- no lee ni escribe user_stats, así que se puede llamar con los valores YA
-- actualizados antes de persistirlos.
create or replace function public._derive_badges(
  p_streak integer,
  p_sessions integer,
  p_meals integer,
  p_macro_days integer,
  p_body_scans integer
) returns text[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(c.id order by c.id), '{}'::text[])
  from public.badge_catalog c
  where case c.metric
    when 'streak'     then coalesce(p_streak, 0)
    when 'sessions'   then coalesce(p_sessions, 0)
    when 'meals'      then coalesce(p_meals, 0)
    when 'macro_days' then coalesce(p_macro_days, 0)
    when 'body_scans' then coalesce(p_body_scans, 0)
  end >= c.threshold;
$$;

-- Aplica un entrenamiento completado sobre las stats del usuario autenticado.
-- El user_id NO es parámetro: se deriva de auth.uid(), así que nadie puede
-- escribir sobre las stats de otro aunque llame la RPC directamente.
-- La racha y el nivel replican EXACTAMENTE lib/streaksMath.ts (tolerancia de
-- hasta 2 días por los descansos del plan, comodín hasta FREEZE_MAX_GAP = 8,
-- nivel = floor(sqrt(xp/100)) + 1) para no alterar el progreso ya ganado.
--
-- EL XP LO CALCULA EL SERVIDOR, NO EL CLIENTE.
-- Antes llegaba en p_base_xp/p_xp_delta y aquí solo se acotaba: un cliente
-- modificado elegía el número dentro del tope. Y peor: el XP se sumaba en CADA
-- llamada — solo total_workouts respetaba "mismo día" —, así que invocar la RPC
-- en bucle subía de nivel sin entrenar. Los dos parámetros SIGUEN en la firma
-- para no romper los builds ya distribuidos, pero se IGNORAN para el monto.
--
-- La acreditación se ancla en evidencia: p_session_id debe ser una fila de
-- workout_sessions del propio usuario, con completed_at, y que no haya cobrado
-- todavía (xp_credited_at null). Un segundo intento con la misma sesión no
-- paga. Sin p_session_id (cliente viejo) se cae a idempotencia POR DÍA, que
-- cierra el abuso aunque sea más basta.
drop function if exists public.apply_workout_stats(integer, date, text[]);
drop function if exists public.apply_workout_stats(integer, date, text[], integer);
create or replace function public.apply_workout_stats(
  p_xp_delta integer default null,
  p_workout_date date default null,
  p_badges text[] default '{}',
  p_base_xp integer default null,
  p_session_id uuid default null
)
returns table (
  current_streak integer,
  longest_streak integer,
  total_xp integer,
  level integer,
  total_workouts integer,
  earned_badges text[],
  streak_freezes integer
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_date date := coalesce(p_workout_date, current_date);
  v_xp integer := 0;
  v_last date;
  v_streak integer;
  v_freezes integer;
  v_gap integer;
  v_margen integer;        -- días de descanso tolerados según el plan activo
  v_new_streak integer;
  v_freeze_used boolean := false;
  v_same_day boolean := false;
  v_paga boolean := true;   -- ¿corresponde acreditar XP en esta llamada?
  v_new_sessions integer;
  v_meals integer;
  v_macro_days integer;
  v_scans integer;
  v_old_badges text[];
  v_derived text[];
  v_fresh text[];
  v_badge_xp integer := 0;
begin
  if v_uid is null then
    raise exception 'apply_workout_stats requiere un usuario autenticado';
  end if;

  insert into public.user_stats (user_id) values (v_uid)
  on conflict (user_id) do nothing;

  -- FOR UPDATE: dos entrenamientos cerrados casi a la vez (o un reintento de
  -- red) no deben leer la misma racha y contarla dos veces.
  select s.last_workout_date, coalesce(s.current_streak, 0), coalesce(s.streak_freezes, 0),
         coalesce(s.total_meals_logged, 0), coalesce(s.total_macro_perfect_days, 0),
         coalesce(s.total_body_scans, 0), coalesce(s.earned_badges, '{}'::text[])
    into v_last, v_streak, v_freezes, v_meals, v_macro_days, v_scans, v_old_badges
  from public.user_stats s
  where s.user_id = v_uid
  for update;

  -- Reclamar evidencia ANTES de calcular nada. La fecha también sale de la
  -- sesión del servidor; p_workout_date se conserva solo por compatibilidad.
  v_date := null;
  if p_session_id is not null then
    update public.workout_sessions w set xp_credited_at = now()
    where w.id = p_session_id and w.user_id = v_uid
      and w.completed_at is not null and w.xp_credited_at is null
    returning w.completed_at::date into v_date;
  else
    update public.workout_sessions w set xp_credited_at = now()
    where w.id = (
      select x.id from public.workout_sessions x
      where x.user_id = v_uid and x.completed_at is not null and x.xp_credited_at is null
      order by x.completed_at desc limit 1 for update skip locked
    ) returning w.completed_at::date into v_date;
  end if;
  if v_date is null then
    return query
      select s.current_streak, s.longest_streak, s.total_xp, s.level,
             s.total_workouts, s.earned_badges, s.streak_freezes
      from public.user_stats s where s.user_id = v_uid;
    return;
  end if;

  v_margen := public._max_rest_gap(v_uid);

  if v_last is null then
    v_new_streak := 1;
  else
    v_gap := v_date - v_last;
    if v_gap <= 0 then
      -- Mismo día (o fecha anterior por reloj desfasado): idempotente.
      v_new_streak := v_streak;
      v_same_day := true;
    elsif v_gap <= v_margen then
      -- v_margen sale del plan del usuario, no de un número fijo: descansar
      -- lo que el plan manda descansar NO rompe la racha (ver _max_rest_gap).
      v_new_streak := v_streak + 1;
    elsif v_freezes > 0 and v_gap <= 8 then
      v_new_streak := v_streak + 1;
      v_freeze_used := true;
    else
      v_new_streak := 1;
    end if;
  end if;

  -- La llamada solo llega aquí si la evidencia fue reclamada arriba.
  v_paga := true;

  -- El monto sale de aquí, no del cliente. Debe reflejar XP_PER_WORKOUT y el
  -- bono de racha de lib/streaks.ts; si cambia allá, cambia aquí.
  if v_paga then
    v_xp := 75 + case
      when v_new_streak >= 7 then 50
      when v_new_streak >= 3 then 25
      else 0
    end;
  end if;

  select coalesce(s.total_workouts, 0) + 1
    into v_new_sessions
  from public.user_stats s where s.user_id = v_uid;

  -- Insignias derivadas de las stats YA actualizadas, no de lo que diga el
  -- cliente. Solo se paga el XP de las que son nuevas de verdad.
  v_derived := public._derive_badges(v_new_streak, v_new_sessions, v_meals, v_macro_days, v_scans);
  select coalesce(array_agg(b), '{}'::text[]) into v_fresh
  from unnest(v_derived) as b where not (b = any (v_old_badges));

  -- El XP de las insignias solo se paga si la llamada tenía derecho a cobrar:
  -- si no, un bucle cobraría los badges una y otra vez.
  if v_paga and array_length(v_fresh, 1) > 0 then
    select coalesce(sum(c.xp), 0) into v_badge_xp
    from public.badge_catalog c where c.id = any (v_fresh);
  end if;

  update public.user_stats s set
    current_streak = v_new_streak,
    longest_streak = greatest(coalesce(s.longest_streak, 0), v_new_streak),
    total_xp = coalesce(s.total_xp, 0) + v_xp + v_badge_xp,
    level = floor(sqrt((coalesce(s.total_xp, 0) + v_xp + v_badge_xp) / 100.0))::integer + 1,
    total_workouts = v_new_sessions,
    earned_badges = v_old_badges || v_fresh,
    last_workout_date = greatest(coalesce(s.last_workout_date, v_date), v_date),
    streak_freezes = greatest(coalesce(s.streak_freezes, 0) - case when v_freeze_used then 1 else 0 end, 0),
    updated_at = now()
  where s.user_id = v_uid;

  return query
    select s.current_streak, s.longest_streak, s.total_xp, s.level,
           s.total_workouts, s.earned_badges, s.streak_freezes
    from public.user_stats s
    where s.user_id = v_uid;
end $$;
grant execute on function public.apply_workout_stats(integer, date, text[], integer, uuid) to authenticated;

-- Actividades que NO son entrenamiento (comida registrada, día perfecto de
-- macros, escaneo corporal). Sin esta RPC, el revoke de arriba dejaría esas
-- tres vías sin forma de escribir y el usuario perdería su XP en silencio.
-- Mismo trato que arriba: p_badges se ignora, las insignias se derivan.
drop function if exists public.apply_activity_stats(text, integer, text[], boolean);
create or replace function public.apply_activity_stats(
  p_kind text,
  p_xp_delta integer,
  p_badges text[] default '{}',
  p_macro_perfect boolean default false,
  p_base_xp integer default null
)
returns table (
  total_xp integer,
  level integer,
  total_meals_logged integer,
  total_macro_perfect_days integer,
  total_body_scans integer,
  earned_badges text[]
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_xp integer;
  v_streak integer;
  v_sessions integer;
  v_meals integer;
  v_macro_days integer;
  v_scans integer;
  v_old_badges text[];
  v_derived text[];
  v_fresh text[];
  v_badge_xp integer := 0;
begin
  if v_uid is null then
    raise exception 'apply_activity_stats requiere un usuario autenticado';
  end if;
  if p_kind not in ('meal', 'body_scan') then
    raise exception 'apply_activity_stats: p_kind inválido (%)', p_kind;
  end if;

  v_xp := least(greatest(coalesce(p_base_xp, p_xp_delta, 0), 0), 1000);

  insert into public.user_stats (user_id) values (v_uid)
  on conflict (user_id) do nothing;

  select coalesce(s.current_streak, 0), coalesce(s.total_workouts, 0),
         coalesce(s.total_meals_logged, 0) + case when p_kind = 'meal' then 1 else 0 end,
         coalesce(s.total_macro_perfect_days, 0) + case when p_kind = 'meal' and p_macro_perfect then 1 else 0 end,
         coalesce(s.total_body_scans, 0) + case when p_kind = 'body_scan' then 1 else 0 end,
         coalesce(s.earned_badges, '{}'::text[])
    into v_streak, v_sessions, v_meals, v_macro_days, v_scans, v_old_badges
  from public.user_stats s where s.user_id = v_uid
  for update;

  v_derived := public._derive_badges(v_streak, v_sessions, v_meals, v_macro_days, v_scans);
  select coalesce(array_agg(b), '{}'::text[]) into v_fresh
  from unnest(v_derived) as b where not (b = any (v_old_badges));

  if p_base_xp is not null and array_length(v_fresh, 1) > 0 then
    select coalesce(sum(c.xp), 0) into v_badge_xp
    from public.badge_catalog c where c.id = any (v_fresh);
  end if;

  update public.user_stats s set
    total_xp = coalesce(s.total_xp, 0) + v_xp + v_badge_xp,
    level = floor(sqrt((coalesce(s.total_xp, 0) + v_xp + v_badge_xp) / 100.0))::integer + 1,
    total_meals_logged = v_meals,
    total_macro_perfect_days = v_macro_days,
    total_body_scans = v_scans,
    earned_badges = v_old_badges || v_fresh,
    updated_at = now()
  where s.user_id = v_uid;

  return query
    select s.total_xp, s.level, s.total_meals_logged,
           s.total_macro_perfect_days, s.total_body_scans, s.earned_badges
    from public.user_stats s
    where s.user_id = v_uid;
end $$;
grant execute on function public.apply_activity_stats(text, integer, text[], boolean, integer) to authenticated;

-- Cobro de una misión semanal. Ahora el servidor VERIFICA la meta contra los
-- datos reales, no solo la idempotencia: antes, quien llamara la RPC con un id
-- válido cobraba aunque no hubiera entrenado nunca.
--
-- p_mission_id viene como "<semana ISO>:<id>", p.ej. "2026-W31:w_workouts3".
-- La semana se PARSEA del propio id y el conteo se hace en ESA semana, no en
-- "la semana actual del servidor": así una diferencia de huso horario entre el
-- teléfono y la base no invalida un cobro legítimo.
--
-- El XP ya no lo propone el cliente: sale de mission_catalog. p_xp se conserva
-- en la firma por compatibilidad con los builds distribuidos, pero se ignora.
--
-- Se DROPea primero porque cambia el tipo de retorno (se agregan ok/reason).
-- Agregar columnas es compatible: PostgREST devuelve JSON y un cliente viejo
-- que solo lee already_claimed las ignora.
drop function if exists public.claim_mission(text, integer);
create or replace function public.claim_mission(
  p_mission_id text,
  p_xp integer default null
)
returns table (
  total_xp integer,
  level integer,
  claimed_missions text[],
  already_claimed boolean,
  ok boolean,
  reason text
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_week text;
  v_slug text;
  v_kind text;
  v_target integer;
  v_xp integer;
  v_start timestamptz;
  v_end timestamptz;
  v_count integer;
  v_already boolean;
begin
  if v_uid is null then
    raise exception 'claim_mission requiere un usuario autenticado';
  end if;
  if p_mission_id is null or length(trim(p_mission_id)) = 0 then
    raise exception 'claim_mission requiere un id de misión';
  end if;

  -- La fila se asegura ANTES de cualquier rama de salida: si no existiera, los
  -- returns de error de abajo devolverían cero filas y el cliente lo leería
  -- como "la RPC no respondió" en vez de como el rechazo que es.
  insert into public.user_stats (user_id) values (v_uid)
  on conflict (user_id) do nothing;

  -- CERROJO DE DÍA, no una misión: "macroday:YYYY-MM-DD". lib/streaks.ts lo usa
  -- para que el bonus de "día perfecto de macros" se pague UNA vez por día,
  -- aprovechando que poner la clave en claimed_missions es atómico. No paga XP
  -- ni verifica meta alguna; solo reserva la clave y dice si ya estaba.
  -- Sin esta rama, el formato estricto de abajo lo rechazaría, la clave nunca
  -- se guardaría y el cliente contaría el día perfecto en CADA comida.
  if p_mission_id ~ '^macroday:\d{4}-\d{2}-\d{2}$' then
    select p_mission_id = any (coalesce(s.claimed_missions, '{}'::text[]))
      into v_already
    from public.user_stats s where s.user_id = v_uid for update;

    if not v_already then
      update public.user_stats s set
        claimed_missions = coalesce(s.claimed_missions, '{}'::text[]) || array[p_mission_id],
        updated_at = now()
      where s.user_id = v_uid;
    end if;

    return query select s.total_xp, s.level, s.claimed_missions,
                        v_already, not v_already, 'day_lock'::text
      from public.user_stats s where s.user_id = v_uid;
    return;
  end if;

  -- Formato estricto: "YYYY-Www:slug". Sin esto no se puede saber qué semana
  -- verificar, y aceptar cualquier cadena reabriría el agujero.
  v_week := substring(p_mission_id from '^(\d{4}-W\d{2}):');
  v_slug := substring(p_mission_id from '^\d{4}-W\d{2}:(.+)$');
  if v_week is null or v_slug is null then
    return query select coalesce(s.total_xp, 0), coalesce(s.level, 1),
                        coalesce(s.claimed_missions, '{}'::text[]), false, false, 'bad_mission_id'::text
      from public.user_stats s where s.user_id = v_uid;
    return;
  end if;

  select c.kind, c.target, c.xp into v_kind, v_target, v_xp
  from public.mission_catalog c where c.id = v_slug;
  if v_kind is null then
    return query select coalesce(s.total_xp, 0), coalesce(s.level, 1),
                        coalesce(s.claimed_missions, '{}'::text[]), false, false, 'unknown_mission'::text
      from public.user_stats s where s.user_id = v_uid;
    return;
  end if;

  insert into public.user_stats (user_id) values (v_uid)
  on conflict (user_id) do nothing;

  select p_mission_id = any (coalesce(s.claimed_missions, '{}'::text[]))
    into v_already
  from public.user_stats s where s.user_id = v_uid for update;

  if v_already then
    return query select s.total_xp, s.level, s.claimed_missions, true, false, 'already_claimed'::text
      from public.user_stats s where s.user_id = v_uid;
    return;
  end if;

  -- Lunes de esa semana ISO. Se ensancha un día por lado a propósito: el
  -- cliente delimita la semana en hora LOCAL y aquí se hace en UTC, así que
  -- sin ese margen una actividad de domingo por la noche (hora local) caería
  -- fuera de la ventana del servidor y le negaríamos una misión ya ganada.
  -- El margen no debilita nada: sigue exigiendo la actividad REAL.
  v_start := to_date(v_week, 'IYYY-"W"IW')::timestamptz - interval '1 day';
  v_end   := v_start + interval '9 days';

  -- OJO con 'workouts' y 'meals': cuentan FILAS, no días. Se conservan porque
  -- las apps ya instaladas siguen pidiendo esas misiones y borrarlas del
  -- catálogo les devolvería 'unknown_mission' — pero las misiones nuevas no
  -- las usan. Ver los tipos por DÍAS de abajo.
  if v_kind = 'workouts' then
    select count(*) into v_count from public.workout_sessions w
    where w.user_id = v_uid and w.completed_at is not null
      and w.started_at >= v_start and w.started_at < v_end;

  elsif v_kind = 'meals' then
    select count(*) into v_count from public.food_logs f
    where f.user_id = v_uid and f.logged_at >= v_start and f.logged_at < v_end;

  -- Adherencia: días DISTINTOS con al menos una sesión terminada. Contar
  -- sesiones dejaba pasar tres entrenos del mismo día como si fueran tres
  -- días de constancia, que es justo lo contrario de lo que mide la misión.
  -- El objetivo sale del plan del usuario, no del catálogo.
  elsif v_kind = 'planned_workouts' then
    v_target := public._planned_workout_days(v_uid);
    select count(distinct (w.started_at at time zone 'UTC')::date) into v_count
    from public.workout_sessions w
    where w.user_id = v_uid and w.completed_at is not null
      and w.started_at >= v_start and w.started_at < v_end;

  -- Nutrición por RESULTADO, no por volumen de registro: días en que de
  -- verdad cubriste tu meta de proteína. "Registra 10 comidas" premiaba abrir
  -- la app; esto premia haber comido lo que tu plan necesita.
  elsif v_kind = 'protein_days' then
    select count(*) into v_count from (
      select (f.logged_at at time zone 'UTC')::date as dia, sum(f.protein_g) as prot
      from public.food_logs f
      where f.user_id = v_uid and f.logged_at >= v_start and f.logged_at < v_end
      group by 1
    ) d
    where d.prot >= coalesce((
      select p.daily_protein_g from public.user_profiles p where p.user_id = v_uid
    ), 999999);

  -- Recuperación: entrenaste Y dejaste descansar. Exige las dos cosas — sin
  -- la primera, no hacer nada en toda la semana cobraría la misión. Los días
  -- se cuentan solo hasta HOY: el resto de la semana todavía no ha pasado.
  elsif v_kind = 'rest_day' then
    select count(distinct (w.started_at at time zone 'UTC')::date) into v_count
    from public.workout_sessions w
    where w.user_id = v_uid and w.completed_at is not null
      and w.started_at >= v_start and w.started_at < v_end;

    if v_count >= 1
       and (least(current_date, (v_start + interval '8 days')::date)
            - (v_start + interval '1 day')::date + 1) > v_count then
      v_count := 1;   -- hubo al menos un día transcurrido sin entrenar
    else
      v_count := 0;
    end if;

  else
    select count(*) into v_count from public.body_scans b
    where b.user_id = v_uid and b.scanned_at >= v_start and b.scanned_at < v_end;
  end if;

  if coalesce(v_count, 0) < v_target then
    return query select s.total_xp, s.level, s.claimed_missions, false, false, 'goal_not_met'::text
      from public.user_stats s where s.user_id = v_uid;
    return;
  end if;

  update public.user_stats s set
    total_xp = coalesce(s.total_xp, 0) + v_xp,
    level = floor(sqrt((coalesce(s.total_xp, 0) + v_xp) / 100.0))::integer + 1,
    claimed_missions = coalesce(s.claimed_missions, '{}'::text[]) || array[p_mission_id],
    updated_at = now()
  where s.user_id = v_uid;

  return query
    select s.total_xp, s.level, s.claimed_missions, false, true, null::text
    from public.user_stats s where s.user_id = v_uid;
end $$;
grant execute on function public.claim_mission(text, integer) to authenticated;

-- Compra de un comodín de racha pagando XP. Es la única RPC que RESTA XP, así
-- que el saldo se verifica en el servidor: sin esto, un cliente modificado
-- podía comprar comodines infinitos con XP que no tenía.
create or replace function public.buy_streak_freeze(p_xp_cost integer default null)
returns table (total_xp integer, level integer, streak_freezes integer, ok boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  -- EL PRECIO ES DEL SERVIDOR. p_xp_cost se conserva en la firma solo para no
  -- romper los builds ya distribuidos, y se IGNORA por completo.
  --
  -- Antes el cliente proponía el precio y aquí solo se acotaba a [1, 5000]:
  -- un cliente modificado compraba por 1 XP algo que cuesta 300. Acotar un
  -- valor que elige el atacante no es una defensa, solo limita el descuento.
  --
  -- ⚠️ ESPEJO de FREEZE_COST en app/(tabs)/progress.tsx. Si cambia allá, cambia
  -- aquí — y la función devuelve el precio realmente cobrado para que la UI no
  -- pueda mostrar un número distinto del que se descontó.
  v_cost constant integer := 300;
  v_xp integer;
  v_freezes integer;
begin
  if v_uid is null then
    raise exception 'buy_streak_freeze requiere un usuario autenticado';
  end if;

  insert into public.user_stats (user_id) values (v_uid)
  on conflict (user_id) do nothing;

  select coalesce(s.total_xp, 0), coalesce(s.streak_freezes, 0)
    into v_xp, v_freezes
  from public.user_stats s where s.user_id = v_uid for update;

  -- Tope de 2 comodines: replica el gate de la UI (progress.tsx) para que no
  -- se pueda acumular una reserva infinita saltándose la pantalla.
  if v_freezes >= 2 then
    return query select v_xp, floor(sqrt(v_xp / 100.0))::integer + 1, v_freezes, false, 'max_freezes'::text;
    return;
  end if;
  if v_xp < v_cost then
    return query select v_xp, floor(sqrt(v_xp / 100.0))::integer + 1, v_freezes, false, 'insufficient_xp'::text;
    return;
  end if;

  update public.user_stats s set
    total_xp = coalesce(s.total_xp, 0) - v_cost,
    level = floor(sqrt(greatest(coalesce(s.total_xp, 0) - v_cost, 0) / 100.0))::integer + 1,
    streak_freezes = coalesce(s.streak_freezes, 0) + 1,
    updated_at = now()
  where s.user_id = v_uid;

  return query
    select s.total_xp, s.level, s.streak_freezes, true, null::text
    from public.user_stats s where s.user_id = v_uid;
end $$;
grant execute on function public.buy_streak_freeze(integer) to authenticated;

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
  notes text, photos_count integer default 1,
  xp_credited_at timestamptz
);
alter table public.body_scans add column if not exists xp_credited_at timestamptz;
select public._apply_owner_rls('body_scans');
create index if not exists body_scans_user_date on public.body_scans(user_id, scanned_at desc);

-- Versión blindada de la acreditación no deportiva. Conserva todos los
-- contadores/eventos existentes, pero el servidor deriva monto y exige una fila
-- real no cobrada. Los parámetros de XP antiguos quedan por compatibilidad y se
-- ignoran deliberadamente.
drop function if exists public.apply_activity_stats(text, integer, text[], boolean, integer);
drop function if exists public.apply_activity_stats(text, integer, text[], boolean, integer, uuid, date);
create or replace function public.apply_activity_stats(
  p_kind text,
  p_xp_delta integer,
  p_badges text[] default '{}',
  p_macro_perfect boolean default false,
  p_base_xp integer default null,
  p_evidence_id uuid default null,
  p_local_day date default null
)
returns table (
  total_xp integer,
  level integer,
  total_meals_logged integer,
  total_macro_perfect_days integer,
  total_body_scans integer,
  earned_badges text[],
  macro_day_counted boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_claimed boolean := false;
  v_xp integer := 0;
  v_streak integer;
  v_sessions integer;
  v_meals integer;
  v_macro_days integer;
  v_scans integer;
  v_old_badges text[];
  v_claimed_missions text[];
  v_key text;
  v_day date := coalesce(p_local_day, current_date);
  v_derived text[];
  v_fresh text[];
  v_badge_xp integer := 0;
  v_macro_counted boolean := false;
begin
  if v_uid is null then raise exception 'Se requiere autenticación'; end if;
  if p_kind not in ('meal', 'body_scan') then raise exception 'Actividad inválida'; end if;
  if v_day < current_date - 1 or v_day > current_date + 1 then v_day := current_date; end if;

  insert into public.user_stats (user_id) values (v_uid)
  on conflict (user_id) do nothing;
  select coalesce(s.current_streak, 0), coalesce(s.total_workouts, 0),
         coalesce(s.total_meals_logged, 0), coalesce(s.total_macro_perfect_days, 0),
         coalesce(s.total_body_scans, 0), coalesce(s.earned_badges, '{}'::text[]),
         coalesce(s.claimed_missions, '{}'::text[])
    into v_streak, v_sessions, v_meals, v_macro_days, v_scans,
         v_old_badges, v_claimed_missions
  from public.user_stats s where s.user_id = v_uid for update;

  if p_kind = 'meal' then
    update public.food_logs f set xp_credited_at = now()
    where f.id = coalesce(p_evidence_id, (
      select x.id from public.food_logs x
      where x.user_id = v_uid and x.xp_credited_at is null
      order by x.logged_at desc limit 1 for update skip locked
    )) and f.user_id = v_uid and f.xp_credited_at is null;
  else
    update public.body_scans b set xp_credited_at = now()
    where b.id = coalesce(p_evidence_id, (
      select x.id from public.body_scans x
      where x.user_id = v_uid and x.xp_credited_at is null
      order by x.scanned_at desc limit 1 for update skip locked
    )) and b.user_id = v_uid and b.xp_credited_at is null;
  end if;
  v_claimed := found;

  if not v_claimed then
    return query select s.total_xp, s.level, s.total_meals_logged,
      s.total_macro_perfect_days, s.total_body_scans, s.earned_badges, false
    from public.user_stats s where s.user_id = v_uid;
    return;
  end if;

  if p_kind = 'meal' then
    v_meals := v_meals + 1;
    v_xp := 15;
    v_key := 'macroday:' || to_char(v_day, 'YYYY-MM-DD');
    if p_macro_perfect and not (v_key = any(v_claimed_missions)) then
      v_macro_counted := true;
      v_macro_days := v_macro_days + 1;
      v_xp := v_xp + 50;
      v_claimed_missions := array_append(v_claimed_missions, v_key);
    end if;
  else
    v_scans := v_scans + 1;
    v_xp := 40;
  end if;

  v_derived := public._derive_badges(v_streak, v_sessions, v_meals, v_macro_days, v_scans);
  select coalesce(array_agg(b), '{}'::text[]) into v_fresh
  from unnest(v_derived) as b where not (b = any(v_old_badges));
  if array_length(v_fresh, 1) > 0 then
    select coalesce(sum(c.xp), 0) into v_badge_xp
    from public.badge_catalog c where c.id = any(v_fresh);
  end if;

  update public.user_stats s set
    total_xp = coalesce(s.total_xp, 0) + v_xp + v_badge_xp,
    level = floor(sqrt((coalesce(s.total_xp, 0) + v_xp + v_badge_xp) / 100.0))::integer + 1,
    total_meals_logged = v_meals,
    total_macro_perfect_days = v_macro_days,
    total_body_scans = v_scans,
    earned_badges = v_old_badges || v_fresh,
    claimed_missions = v_claimed_missions,
    updated_at = now()
  where s.user_id = v_uid;

  return query select s.total_xp, s.level, s.total_meals_logged,
    s.total_macro_perfect_days, s.total_body_scans, s.earned_badges, v_macro_counted
  from public.user_stats s where s.user_id = v_uid;
end $$;
grant execute on function public.apply_activity_stats(text, integer, text[], boolean, integer, uuid, date) to authenticated;

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

-- ─── EVENTOS DEL WEBHOOK DE REVENUECAT (idempotencia/orden) ──
-- Sin RLS de owner: solo la Edge Function (service role) escribe/lee aquí.
-- No confundir con user_profiles.is_premium, que es lo que el cliente lee.
create table if not exists public.rc_webhook_events (
  event_id text primary key,
  user_id uuid,
  event_type text not null,
  event_timestamp_ms bigint not null,
  environment text,
  received_at timestamptz default now()
);
alter table public.rc_webhook_events enable row level security; -- sin políticas: solo service role
create index if not exists rc_webhook_events_user on public.rc_webhook_events(user_id, event_timestamp_ms desc);

-- ─── REPORTES DE CONTENIDO DE IA (exigido por Google Play) ──
-- El usuario reporta una respuesta de la IA (chat, postura, escaneo corporal,
-- comida, nevera) como ofensiva, dañina o incorrecta. No borra ni oculta el
-- contenido — solo queda auditable para revisión/mejora de moderación.
create table if not exists public.ai_content_reports (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  feature text not null,           -- 'coach_chat' | 'posture' | 'body_scan' | 'food_scan' | 'fridge_scan'
  reason text not null,            -- 'incorrect' | 'harmful' | 'offensive' | 'other'
  note text,
  content_snapshot text,           -- copia truncada de lo reportado, para poder revisarlo
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz default now()
);
select public._apply_owner_rls('ai_content_reports');
create index if not exists ai_content_reports_status on public.ai_content_reports(status, created_at desc);

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
-- BRIN crece muy poco y acelera barridos temporales sobre millones de eventos
-- sin reemplazar ningún evento ni ninguna métrica existente.
create index if not exists analytics_ts_brin on public.analytics_events using brin(ts);
create index if not exists analytics_event_ts on public.analytics_events(event, ts desc);

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

-- El user_id ya NO es parámetro. Antes esta función era SECURITY DEFINER,
-- estaba concedida a 'authenticated' y aceptaba cualquier p_user_id sin
-- compararlo contra auth.uid(): un usuario podía llamarla en bucle con el uuid
-- de otro y agotarle la cuota de IA del día. Y como ai_usage tiene RLS activada
-- pero SIN políticas, esta función era TODA la protección de la tabla. Ahora el
-- dueño se deriva del JWT, así que no hay nada que suplantar desde el cliente.
drop function if exists public.increment_ai_usage(uuid, text, integer);

create or replace function public.increment_ai_usage(p_feature text, p_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  current_count integer;
begin
  if v_uid is null then
    raise exception 'increment_ai_usage requiere un usuario autenticado';
  end if;

  insert into public.ai_usage (user_id, date, feature, count)
  values (v_uid, current_date, p_feature, 1)
  on conflict (user_id, date, feature)
  do update set count = public.ai_usage.count + 1
  returning count into current_count;
  return current_count <= p_limit;
end $$;
grant execute on function public.increment_ai_usage(text, integer) to authenticated;

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
-- ─── APLICAR UN EVENTO DE REVENUECAT, ATÓMICAMENTE ───────
-- Antes esto eran cuatro operaciones sueltas desde la Edge Function: leer si
-- el evento ya se procesó, leer el último evento de estado, actualizar
-- is_premium y registrar el evento. Entre cualquiera de esos pasos cabe otra
-- entrega concurrente de RevenueCat — que reintenta las fallidas — y el
-- resultado podía ser un estado premium escrito por el evento equivocado.
--
-- Aquí es UNA transacción: el insert del event_id hace de cerrojo de
-- idempotencia (on conflict do nothing), y el bloqueo de la fila del perfil
-- impide que dos eventos del mismo usuario se pisen.
create or replace function public.apply_rc_event(
  p_event_id text,
  p_user_id uuid,
  p_event_type text,
  p_event_ts_ms bigint,
  p_environment text,
  p_is_premium boolean,        -- null = el evento no cambia el estado
  p_state_changing boolean
)
returns table (aplicado boolean, duplicado boolean, motivo text)
language plpgsql security definer set search_path = public as $$
declare
  v_ultimo bigint;
begin
  -- 1. Cerrojo de idempotencia. Si el event_id ya estaba, es un reintento de
  --    RevenueCat: se confirma sin reaplicar nada.
  insert into public.rc_webhook_events(event_id, user_id, event_type, event_timestamp_ms, environment)
  values (p_event_id, p_user_id, p_event_type, p_event_ts_ms, p_environment)
  on conflict (event_id) do nothing;
  if not found then
    return query select false, true, 'evento ya procesado'::text;
    return;
  end if;

  if p_user_id is null or p_is_premium is null or not p_state_changing then
    return query select false, false, 'evento registrado sin cambio de estado'::text;
    return;
  end if;

  -- 2. Bloquea la fila del perfil: dos eventos del mismo usuario se serializan.
  perform 1 from public.user_profiles where user_id = p_user_id for update;

  -- 3. Orden: no pisar un estado más reciente con un evento más viejo. Se
  --    compara SOLO contra eventos que también cambian is_premium; el evento
  --    recién insertado se excluye por su propio id.
  select max(e.event_timestamp_ms) into v_ultimo
  from public.rc_webhook_events e
  where e.user_id = p_user_id
    and e.event_id <> p_event_id
    and e.event_type = any (array['INITIAL_PURCHASE','RENEWAL','UNCANCELLATION','EXPIRATION','TRANSFER','PRODUCT_CHANGE','SUBSCRIPTION_PAUSED']);

  if v_ultimo is not null and v_ultimo > p_event_ts_ms then
    return query select false, false, 'evento fuera de orden, ignorado'::text;
    return;
  end if;

  update public.user_profiles set is_premium = p_is_premium where user_id = p_user_id;
  return query select true, false, null::text;
end $$;
revoke all on function public.apply_rc_event(text,uuid,text,bigint,text,boolean,boolean) from anon, authenticated;
revoke all on function public.apply_rc_event(text,uuid,text,bigint,text,boolean,boolean) from public;
