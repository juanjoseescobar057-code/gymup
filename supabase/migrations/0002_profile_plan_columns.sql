-- supabase/migrations/0002_profile_plan_columns.sql
-- ─────────────────────────────────────────────────────────
-- Añade columnas que el código YA usa pero que faltaban en el
-- esquema desplegado: current_plan_day y last_active_date.
-- Sin esto, el avance del plan y el "último acceso" fallan en silencio.
-- ─────────────────────────────────────────────────────────

alter table public.user_profiles
  add column if not exists current_plan_day integer not null default 0;

alter table public.user_profiles
  add column if not exists last_active_date date;

-- Restringir el rango del día del plan (0-6) si aún no existe la restricción.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_profiles_plan_day_check'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_plan_day_check check (current_plan_day between 0 and 6);
  end if;
end $$;
