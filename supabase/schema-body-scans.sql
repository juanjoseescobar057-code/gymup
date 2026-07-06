-- supabase/schema-body-scans.sql
-- ─────────────────────────────────────────────────────────
-- Tabla de análisis corporal (body_scans).
-- IMPORTANTE: NUNCA se guardan las fotos, solo los datos numéricos
-- del análisis generado por la IA. Ejecutar DESPUÉS de schema.sql.
-- ─────────────────────────────────────────────────────────

create table if not exists public.body_scans (
  id                     uuid primary key default uuid_generate_v4(),
  user_id                uuid references auth.users(id) on delete cascade not null,
  scanned_at             timestamptz default now(),
  overall_score          integer check (overall_score between 0 and 100),
  estimated_fat_pct      numeric(4,1) check (estimated_fat_pct between 0 and 60),
  estimated_muscle_level text,
  zones                  jsonb,
  strengths              jsonb,
  focus_areas            jsonb,
  notes                  text,
  photos_count           integer default 1
  -- Sin columna de foto: las imágenes nunca se persisten.
);

alter table public.body_scans enable row level security;

-- Políticas con WITH CHECK para que un usuario no pueda escribir
-- filas con el user_id de otra persona.
create policy "body_scans_select_own" on public.body_scans
  for select using (auth.uid() = user_id);
create policy "body_scans_insert_own" on public.body_scans
  for insert with check (auth.uid() = user_id);
create policy "body_scans_update_own" on public.body_scans
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "body_scans_delete_own" on public.body_scans
  for delete using (auth.uid() = user_id);

create index if not exists body_scans_user_date
  on public.body_scans(user_id, scanned_at desc);
