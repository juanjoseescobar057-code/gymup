-- supabase/fix-grants.sql
-- Parche rápido: otorga los permisos que faltaban en las tablas nuevas.
-- Solo hace falta correrlo UNA vez en un proyecto ya desplegado con el
-- setup.sql viejo (antes del fix de GRANT). setup.sql ya lo incluye
-- para instalaciones nuevas.

grant select, insert, update, delete on public.set_logs to anon, authenticated;
grant select, insert, update, delete on public.body_scans to anon, authenticated;
grant select, insert, update, delete on public.push_tokens to anon, authenticated;
grant select, insert, update, delete on public.posture_feedback to anon, authenticated;
grant select, insert, update, delete on public.notification_preferences to anon, authenticated;
