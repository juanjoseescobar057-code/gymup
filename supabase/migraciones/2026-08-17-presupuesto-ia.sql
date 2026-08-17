-- Migración: presupuesto de IA en dinero + periodo de prueba
-- Extraído de supabase/setup.sql. Correr ENTERO, en una sola pasada.
-- Ver docs/DEPLOY_PRESUPUESTO.md

-- ─── PERIODO DE PRUEBA ───────────────────────────────────
-- Sin esto, quien está en los 7 días gratis es indistinguible de quien paga:
-- entra con los topes premium completos y con presupuesto de premium, sin
-- haber pagado nada. Y abrir otra prueba solo cuesta otra cuenta de Google.
-- Lo escribe supabase/functions/rc-webhook a partir de period_type.
alter table public.user_profiles
  add column if not exists is_trial boolean not null default false;

-- ─── PRESUPUESTO DE IA, EN DINERO ────────────────────────
-- Los topes de ai_usage cuentan LLAMADAS y son DIARIOS. Ninguna de las dos
-- cosas acota lo que de verdad importa:
--
--   • Contar llamadas no distingue un mensaje de chat (~$0.008) de generar un
--     plan (~$0.034). Quien quiera hacer daño elige las caras.
--   • Sin techo mensual, el peor caso es el tope diario multiplicado por 30.
--     Con los topes que había, eso salía ~$24/mes por usuario contra ~$5 de
--     ingreso neto: un solo usuario decidido costaba cinco veces lo que paga.
--
-- Esta tabla acumula el costo REAL en dólares por usuario y mes natural, y es
-- el único límite denominado en la misma unidad que la pérdida. Los topes
-- diarios se quedan, pero para dar forma a la experiencia: el techo es este.
create table if not exists public.ai_cost_usage (
  user_id  uuid not null references auth.users(id) on delete cascade,
  month    date not null,                       -- primer día del mes
  cost_usd numeric(12,6) not null default 0,
  calls    integer not null default 0,
  primary key (user_id, month)
);
alter table public.ai_cost_usage enable row level security; -- sin políticas: solo las RPC

-- Cuánto le queda al usuario del presupuesto de este mes. La llama el proxy
-- con el JWT de la persona, así que deriva el dueño de auth.uid(): no hay
-- user_id que suplantar. Devuelve el remanente y no un booleano para que el
-- proxy pueda decidir y registrar cuánto quedaba.
create or replace function public.ai_budget_restante(p_budget_usd numeric)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_gastado numeric;
begin
  if v_uid is null then
    raise exception 'ai_budget_restante requiere un usuario autenticado';
  end if;

  select cost_usd into v_gastado
  from public.ai_cost_usage
  where user_id = v_uid and month = date_trunc('month', current_date)::date;

  return p_budget_usd - coalesce(v_gastado, 0);
end $$;
grant execute on function public.ai_budget_restante(numeric) to authenticated;

-- Suma el costo de una llamada ya hecha.
--
-- MISMO CUIDADO CON LOS PERMISOS QUE refund_ai_usage, por el motivo inverso:
-- si fuera ejecutable por 'authenticated', un cliente modificado podría
-- inflarle el gasto a OTRO usuario hasta dejarlo sin IA el resto del mes. Y no
-- puede derivar el dueño de auth.uid() porque el costo solo se conoce DESPUÉS
-- de que el proveedor responda, cuando el proxy ya actúa como servidor.
-- Por eso recibe el user_id, y queda reservada al service_role.
create or replace function public.record_ai_cost(p_user_id uuid, p_cost_usd numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null or p_cost_usd is null or p_cost_usd <= 0 then return; end if;

  insert into public.ai_cost_usage (user_id, month, cost_usd, calls)
  values (p_user_id, date_trunc('month', current_date)::date, p_cost_usd, 1)
  on conflict (user_id, month) do update
    set cost_usd = public.ai_cost_usage.cost_usd + excluded.cost_usd,
        calls    = public.ai_cost_usage.calls + 1;
end $$;
revoke all on function public.record_ai_cost(uuid, numeric) from public, anon, authenticated;
grant execute on function public.record_ai_cost(uuid, numeric) to service_role;


-- ─── apply_rc_event: firma nueva con p_is_trial ───
create or replace function public.apply_rc_event(
  p_event_id text,
  p_user_id uuid,
  p_event_type text,
  p_event_ts_ms bigint,
  p_environment text,
  p_is_premium boolean,        -- null = el evento no cambia el estado
  p_state_changing boolean,
  p_is_trial boolean default null  -- null = el evento no dice nada de la prueba
)
returns table (aplicado boolean, duplicado boolean, motivo text)
language plpgsql security definer set search_path = public as $$
declare
  v_ultimo bigint;
begin
  -- 1. Cerrojo de idempotencia. Si el event_id ya estaba, es un reintento de
  --    RevenueCat: se confirma sin reaplicar nada.
  insert into public.rc_webhook_events(event_id, user_id, event_type, event_timestamp_ms, environment)
  values (p_event_id, p_user_id, p_event_type, p_event_ts_ms, p_environment)
  on conflict (event_id) do nothing;
  if not found then
    return query select false, true, 'evento ya procesado'::text;
    return;
  end if;

  if p_user_id is null or p_is_premium is null or not p_state_changing then
    return query select false, false, 'evento registrado sin cambio de estado'::text;
    return;
  end if;

  -- 2. Bloquea la fila del perfil: dos eventos del mismo usuario se serializan.
  perform 1 from public.user_profiles where user_id = p_user_id for update;

  -- 3. Orden: no pisar un estado más reciente con un evento más viejo. Se
  --    compara SOLO contra eventos que también cambian is_premium; el evento
  --    recién insertado se excluye por su propio id.
  select max(e.event_timestamp_ms) into v_ultimo
  from public.rc_webhook_events e
  where e.user_id = p_user_id
    and e.event_id <> p_event_id
    and e.event_type = any (array['INITIAL_PURCHASE','RENEWAL','UNCANCELLATION','EXPIRATION','TRANSFER','PRODUCT_CHANGE','SUBSCRIPTION_PAUSED']);

  if v_ultimo is not null and v_ultimo > p_event_ts_ms then
    return query select false, false, 'evento fuera de orden, ignorado'::text;
    return;
  end if;

  -- Perder el premium apaga la prueba pase lo que pase: si no, alguien que
  -- probó, dejó que expirara y volvió a entrar conservaría la marca de prueba
  -- y con ella el presupuesto de $0.25 en vez del de premium.
  update public.user_profiles
     set is_premium = p_is_premium,
         is_trial   = case when p_is_premium then coalesce(p_is_trial, is_trial) else false end
   where user_id = p_user_id;
  return query select true, false, null::text;
end $$;
revoke all on function public.apply_rc_event(text,uuid,text,bigint,text,boolean,boolean,boolean) from anon, authenticated;
revoke all on function public.apply_rc_event(text,uuid,text,bigint,text,boolean,boolean,boolean) from public;
-- La firma vieja (sin p_is_trial) se elimina: dejarla viva sería un camino que
-- escribe is_premium sin tocar is_trial, y Postgres elegiría una u otra por
-- resolución de sobrecarga según cómo llame el cliente.
drop function if exists public.apply_rc_event(text,uuid,text,bigint,text,boolean,boolean);

