-- supabase/schema.sql
-- ─────────────────────────────────────────────────────────
-- Schema completo de GymAI en Supabase
-- Ejecuta esto en el SQL Editor de tu proyecto de Supabase
-- ─────────────────────────────────────────────────────────

-- Habilitar extensiones necesarias
create extension if not exists "uuid-ossp";

-- ─── Tabla: Perfiles de usuario ──────────────────────────
create table public.user_profiles (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null unique,
  name          text not null,
  age           integer not null check (age between 18 and 90),  -- App solo para mayores de 18
  weight_kg     numeric(5,1) not null check (weight_kg between 30 and 300),
  height_cm     numeric(5,1) not null check (height_cm between 130 and 230),
  goal          text not null check (goal in ('muscle_gain','fat_loss','performance','endurance')),
  activity_level text not null check (activity_level in ('sedentary','light','moderate','active','very_active')),
  -- Macros calculados por la IA
  daily_calories  integer not null default 2000,
  daily_protein_g integer not null default 150,
  daily_carbs_g   integer not null default 200,
  daily_fat_g     integer not null default 65,
  -- Progreso del plan: avanza al completar entrenos, no por día de la semana.
  current_plan_day integer not null default 0 check (current_plan_day between 0 and 6),
  last_active_date date,
  is_premium    boolean not null default false,  -- actualizado por webhook de RevenueCat
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ─── Tabla: Planes de entrenamiento ─────────────────────
create table public.training_plans (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  week_number   integer not null default 1,
  plan_data     jsonb not null,  -- WeeklyPlan completo generado por GPT-4o
  is_active     boolean default true,
  generated_at  timestamptz default now()
);

-- ─── Tabla: Registro de comidas ─────────────────────────
create table public.food_logs (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid references auth.users(id) on delete cascade not null,
  logged_at        timestamptz default now(),
  meal_name        text not null,
  food_description text,
  photo_url        text,
  calories         integer not null default 0,
  protein_g        numeric(6,1) not null default 0,
  carbs_g          numeric(6,1) not null default 0,
  fat_g            numeric(6,1) not null default 0,
  fiber_g          numeric(6,1) not null default 0
);

-- ─── Tabla: Sesiones de entrenamiento ───────────────────
create table public.workout_sessions (
  id                    uuid primary key default uuid_generate_v4(),
  user_id               uuid references auth.users(id) on delete cascade not null,
  training_plan_id      uuid references public.training_plans(id),
  day_index             integer not null,  -- índice del día en el plan (0-6)
  started_at            timestamptz default now(),
  completed_at          timestamptz,
  duration_min          integer,
  exercises_completed   integer default 0,
  posture_score_avg     numeric(4,1)  -- promedio de puntaje de postura del día
);

-- ─── Tabla: Feedback de postura ──────────────────────────
create table public.posture_feedback (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  session_id    uuid references public.workout_sessions(id),
  exercise_name text not null,
  score         integer not null check (score between 0 and 100),
  corrections   jsonb,  -- array de strings con correcciones
  recorded_at   timestamptz default now()
);

-- ─── Políticas de seguridad (Row Level Security) ─────────
-- Cada usuario solo puede ver/modificar sus propios datos

alter table public.user_profiles enable row level security;
alter table public.training_plans enable row level security;
alter table public.food_logs enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.posture_feedback enable row level security;

-- IMPORTANTE: usamos políticas por operación con WITH CHECK en insert/update.
-- Una política 'for all using (...)' NO valida el user_id en INSERT, lo que
-- permitiría a un usuario crear filas con el user_id de otra persona.

-- Macro reutilizable conceptual (Postgres no tiene macros: se repite el patrón).
-- Para cada tabla: select/delete con USING, insert/update con WITH CHECK.

-- user_profiles
create policy "user_profiles_select" on public.user_profiles for select using (auth.uid() = user_id);
create policy "user_profiles_insert" on public.user_profiles for insert with check (auth.uid() = user_id);
create policy "user_profiles_update" on public.user_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_profiles_delete" on public.user_profiles for delete using (auth.uid() = user_id);

-- training_plans
create policy "training_plans_select" on public.training_plans for select using (auth.uid() = user_id);
create policy "training_plans_insert" on public.training_plans for insert with check (auth.uid() = user_id);
create policy "training_plans_update" on public.training_plans for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "training_plans_delete" on public.training_plans for delete using (auth.uid() = user_id);

-- food_logs
create policy "food_logs_select" on public.food_logs for select using (auth.uid() = user_id);
create policy "food_logs_insert" on public.food_logs for insert with check (auth.uid() = user_id);
create policy "food_logs_update" on public.food_logs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "food_logs_delete" on public.food_logs for delete using (auth.uid() = user_id);

-- workout_sessions
create policy "workout_sessions_select" on public.workout_sessions for select using (auth.uid() = user_id);
create policy "workout_sessions_insert" on public.workout_sessions for insert with check (auth.uid() = user_id);
create policy "workout_sessions_update" on public.workout_sessions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "workout_sessions_delete" on public.workout_sessions for delete using (auth.uid() = user_id);

-- posture_feedback
create policy "posture_feedback_select" on public.posture_feedback for select using (auth.uid() = user_id);
create policy "posture_feedback_insert" on public.posture_feedback for insert with check (auth.uid() = user_id);
create policy "posture_feedback_update" on public.posture_feedback for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "posture_feedback_delete" on public.posture_feedback for delete using (auth.uid() = user_id);

-- ─── Índices para consultas frecuentes ──────────────────
create index food_logs_user_date on public.food_logs(user_id, logged_at);
create index sessions_user_date on public.workout_sessions(user_id, started_at);
create index plans_user_active on public.training_plans(user_id, is_active);

-- ─── Función: actualizar updated_at automáticamente ──────
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at
  before update on public.user_profiles
  for each row execute function public.handle_updated_at();
