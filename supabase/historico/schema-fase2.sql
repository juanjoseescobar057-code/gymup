-- supabase/schema-fase2.sql
-- ─────────────────────────────────────────────────────────
-- Tablas adicionales para la Fase 2:
-- Rachas, XP, Badges, Peso y Fotos de transformación
-- Ejecuta esto DESPUÉS del schema.sql inicial
-- ─────────────────────────────────────────────────────────

-- ─── Stats del usuario (racha, XP, badges) ──────────────
create table public.user_stats (
  id                        uuid primary key default uuid_generate_v4(),
  user_id                   uuid references auth.users(id) on delete cascade not null unique,
  current_streak            integer default 0,
  longest_streak            integer default 0,
  total_xp                  integer default 0,
  level                     integer default 1,
  total_workouts            integer default 0,
  total_meals_logged        integer default 0,
  total_macro_perfect_days  integer default 0,
  total_body_scans          integer default 0,
  earned_badges             text[] default '{}',          -- array de badge IDs
  last_workout_date         date,
  streak_freezes            integer not null default 1,   -- comodines anti-rotura
  claimed_missions          text[] not null default '{}', -- misiones semanales reclamadas
  updated_at                timestamptz default now()
);

alter table public.user_stats enable row level security;
create policy "user_stats_select" on public.user_stats for select using (auth.uid() = user_id);
create policy "user_stats_insert" on public.user_stats for insert with check (auth.uid() = user_id);
create policy "user_stats_update" on public.user_stats for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_stats_delete" on public.user_stats for delete using (auth.uid() = user_id);

-- ─── Registro de peso ────────────────────────────────────
create table public.weight_entries (
  id        uuid primary key default uuid_generate_v4(),
  user_id   uuid references auth.users(id) on delete cascade not null,
  date      date not null,
  weight    numeric(5,2) not null check (weight between 30 and 300),
  unique(user_id, date)   -- un registro por día
);

alter table public.weight_entries enable row level security;
create policy "weight_entries_select" on public.weight_entries for select using (auth.uid() = user_id);
create policy "weight_entries_insert" on public.weight_entries for insert with check (auth.uid() = user_id);
create policy "weight_entries_update" on public.weight_entries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "weight_entries_delete" on public.weight_entries for delete using (auth.uid() = user_id);

create index weight_user_date on public.weight_entries(user_id, date);

-- ─── Fotos de transformación ──────────────────────────────
create table public.transform_photos (
  id        text primary key,
  user_id   uuid references auth.users(id) on delete cascade not null,
  uri       text not null,        -- URL pública en Supabase Storage
  date      date not null,
  note      text
);

alter table public.transform_photos enable row level security;
create policy "transform_photos_select" on public.transform_photos for select using (auth.uid() = user_id);
create policy "transform_photos_insert" on public.transform_photos for insert with check (auth.uid() = user_id);
create policy "transform_photos_update" on public.transform_photos for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "transform_photos_delete" on public.transform_photos for delete using (auth.uid() = user_id);

-- ─── Supabase Storage: bucket para fotos de transformación ──
-- Ejecuta esto también en SQL Editor:
insert into storage.buckets (id, name, public)
values ('transform-photos', 'transform-photos', true)
on conflict do nothing;

create policy "Users can upload their own transform photos"
  on storage.objects for insert
  with check (bucket_id = 'transform-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Transform photos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'transform-photos');

create policy "Users can delete their own transform photos"
  on storage.objects for delete
  using (bucket_id = 'transform-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- ─── Notificaciones: guardar preferencias ────────────────
create table public.notification_preferences (
  user_id       uuid references auth.users(id) on delete cascade not null primary key,
  workout_days  integer[] default '{1,2,3,4,5}',  -- días de gym [1=Lun..7=Dom]
  wake_up_hour  integer default 7,
  workout_hour  integer default 18,
  enabled       boolean default true,
  updated_at    timestamptz default now()
);

alter table public.notification_preferences enable row level security;
create policy "notif_prefs_select" on public.notification_preferences for select using (auth.uid() = user_id);
create policy "notif_prefs_insert" on public.notification_preferences for insert with check (auth.uid() = user_id);
create policy "notif_prefs_update" on public.notification_preferences for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notif_prefs_delete" on public.notification_preferences for delete using (auth.uid() = user_id);
