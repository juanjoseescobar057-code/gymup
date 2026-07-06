-- supabase/schema-ai-usage.sql
-- ─────────────────────────────────────────────────────────
-- Rate limiting del proxy de IA, POR FEATURE y por día.
-- Permite topes distintos por función (ej: 3 escaneos de comida/día free).
-- ─────────────────────────────────────────────────────────

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  date    date not null default current_date,
  feature text not null default 'general',
  count   integer not null default 0,
  primary key (user_id, date, feature)
);

-- RLS activado SIN políticas de cliente: solo la función increment_ai_usage
-- (SECURITY DEFINER) la toca. Los usuarios no leen ni escriben aquí.
alter table public.ai_usage enable row level security;

-- Incrementa el contador del día PARA ESA FEATURE de forma atómica y
-- devuelve si el usuario sigue dentro del límite.
create or replace function public.increment_ai_usage(
  p_user_id uuid,
  p_feature text,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
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
