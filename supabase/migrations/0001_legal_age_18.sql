-- supabase/migrations/0001_legal_age_18.sql
-- ─────────────────────────────────────────────────────────
-- Sube la edad mínima de 13 a 18 años en bases de datos YA desplegadas.
-- (schema.sql ya refleja el valor nuevo para instalaciones limpias.)
--
-- ⚠️ Si ya existen perfiles con age < 18, primero decide qué hacer con
--    ellos (borrarlos / contactarlos). La restricción nueva NO se puede
--    crear mientras existan filas que la violen.
-- ─────────────────────────────────────────────────────────

-- 1. Revisar si hay menores registrados antes de aplicar:
--    select count(*) from public.user_profiles where age < 18;

-- 2. (Opcional, decisión de negocio) eliminar perfiles de menores:
--    delete from public.user_profiles where age < 18;

-- 3. Reemplazar la restricción de edad:
alter table public.user_profiles
  drop constraint if exists user_profiles_age_check;

alter table public.user_profiles
  add constraint user_profiles_age_check check (age between 18 and 90);
