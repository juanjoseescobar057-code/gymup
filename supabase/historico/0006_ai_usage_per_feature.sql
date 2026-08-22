-- supabase/migrations/0006_ai_usage_per_feature.sql
-- ─────────────────────────────────────────────────────────
-- Migra ai_usage a conteo POR FEATURE. Como es solo un contador diario
-- efímero, se recrea sin pérdida relevante.
-- ─────────────────────────────────────────────────────────

drop function if exists public.increment_ai_usage(uuid, integer);
drop table if exists public.ai_usage;

create table public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  date    date not null default current_date,
  feature text not null default 'general',
  count   integer not null default 0,
  primary key (user_id, date, feature)
);
alter table public.ai_usage enable row level security;

create or replace function public.increment_ai_usage(
  p_user_id uuid, p_feature text, p_limit integer
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare current_count integer;
begin
  insert into public.ai_usage (user_id, date, feature, count)
  values (p_user_id, current_date, p_feature, 1)
  on conflict (user_id, date, feature)
  do update set count = public.ai_usage.count + 1
  returning count into current_count;
  return current_count <= p_limit;
end;
$$;

grant execute on function public.increment_ai_usage(uuid, text, integer) to authenticated;
