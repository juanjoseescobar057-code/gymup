-- supabase/migrations/0003_rls_with_check.sql
-- ─────────────────────────────────────────────────────────
-- Endurece RLS: reemplaza las políticas 'for all using (...)' (que NO
-- validan el user_id en INSERT) por políticas por operación con WITH CHECK.
-- Sin esto, un usuario autenticado puede insertar/actualizar filas con el
-- user_id de otra persona (OWASP A01 - Broken Access Control).
-- ─────────────────────────────────────────────────────────

do $$
declare
  t text;
  tables text[] := array[
    'user_profiles', 'training_plans', 'food_logs', 'workout_sessions',
    'posture_feedback', 'user_stats', 'weight_entries', 'transform_photos',
    'notification_preferences', 'body_scans'
  ];
  pol record;
begin
  foreach t in array tables loop
    -- Saltar tablas que no existan aún.
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    -- 1. Eliminar TODAS las políticas existentes de la tabla.
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;

    -- 2. Recrear con WITH CHECK por operación.
    execute format('create policy %I on public.%I for select using (auth.uid() = user_id)', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (auth.uid() = user_id)', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (auth.uid() = user_id)', t || '_delete', t);
  end loop;
end $$;
