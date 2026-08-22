-- supabase/schema-push.sql
-- ─────────────────────────────────────────────────────────
-- Tokens de Expo Push por dispositivo. Permiten reactivar a usuarios
-- que NO abren la app (las notificaciones locales no alcanzan ahí).
-- ─────────────────────────────────────────────────────────

create table if not exists public.push_tokens (
  token       text primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  platform    text,
  updated_at  timestamptz default now()
);

alter table public.push_tokens enable row level security;

create policy "push_tokens_select" on public.push_tokens for select using (auth.uid() = user_id);
create policy "push_tokens_insert" on public.push_tokens for insert with check (auth.uid() = user_id);
create policy "push_tokens_update" on public.push_tokens for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "push_tokens_delete" on public.push_tokens for delete using (auth.uid() = user_id);

create index if not exists push_tokens_user on public.push_tokens(user_id);
