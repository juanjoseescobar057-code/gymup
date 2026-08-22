-- supabase/migrations/0004_gamification_extras.sql
-- ─────────────────────────────────────────────────────────
-- Columnas para streak-freeze y misiones semanales en user_stats.
-- ─────────────────────────────────────────────────────────

alter table public.user_stats
  add column if not exists streak_freezes integer not null default 1;

alter table public.user_stats
  add column if not exists claimed_missions text[] not null default '{}';
