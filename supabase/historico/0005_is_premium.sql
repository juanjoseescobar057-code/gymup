-- supabase/migrations/0005_is_premium.sql
-- Bandera de suscripción premium en el perfil. La actualiza el webhook
-- de RevenueCat (vía Edge Function con service role), no el cliente.

alter table public.user_profiles
  add column if not exists is_premium boolean not null default false;
