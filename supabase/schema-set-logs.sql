-- supabase/schema-set-logs.sql
-- ─────────────────────────────────────────────────────────
-- Registro real de series: peso y reps LOGRADOS en cada serie.
-- Es la base de la sobrecarga progresiva (comparar contra la última vez).
-- Ejecutar DESPUÉS de schema.sql.
-- ─────────────────────────────────────────────────────────

create table if not exists public.set_logs (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  session_id    uuid references public.workout_sessions(id) on delete cascade,
  exercise_name text not null,
  set_number    integer not null check (set_number > 0),
  weight_kg     numeric(6,2) check (weight_kg >= 0 and weight_kg <= 1000),
  reps          integer check (reps >= 0 and reps <= 1000),
  logged_at     timestamptz default now()
);

alter table public.set_logs enable row level security;

create policy "set_logs_select" on public.set_logs for select using (auth.uid() = user_id);
create policy "set_logs_insert" on public.set_logs for insert with check (auth.uid() = user_id);
create policy "set_logs_update" on public.set_logs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "set_logs_delete" on public.set_logs for delete using (auth.uid() = user_id);

-- Índice para "la última vez que hice este ejercicio".
create index if not exists set_logs_user_exercise
  on public.set_logs(user_id, exercise_name, logged_at desc);
