-- Safety, idempotency, evidence-based progression and plan versioning.
-- Idempotent enough for environments that received parts of setup.sql manually.

alter table public.user_profiles add column if not exists training_experience text not null default 'principiante';
alter table public.user_profiles add column if not exists days_per_week integer not null default 3;
alter table public.user_profiles add column if not exists equipment text not null default 'gym';
do $$ begin
  alter table public.user_profiles add constraint user_profiles_training_experience_check
    check (training_experience in ('principiante','intermedio','avanzado'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.user_profiles add constraint user_profiles_days_per_week_check
    check (days_per_week between 1 and 7);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.user_profiles add constraint user_profiles_equipment_check
    check (equipment in ('gym','casa_basico','casa_sin_equipo'));
exception when duplicate_object then null; end $$;
grant update (training_experience, days_per_week, equipment) on public.user_profiles to anon, authenticated;

alter table public.training_plans add column if not exists parent_plan_id uuid references public.training_plans(id);
alter table public.training_plans add column if not exists change_reason jsonb not null default '{}'::jsonb;
alter table public.training_plans add column if not exists replaced_at timestamptz;
with ranked as (
  select id, row_number() over (partition by user_id order by generated_at desc, id desc) rn
  from public.training_plans where is_active
)
update public.training_plans p set is_active=false, replaced_at=coalesce(p.replaced_at,now())
from ranked r where p.id=r.id and r.rn>1;
-- ÍNDICE APLAZADO A PROPÓSITO. El invariante (un solo plan activo por usuario)
-- es correcto, pero las apps YA INSTALADAS (build 12 y anteriores) guardan un
-- plan regenerado en el orden contrario: primero insertan el nuevo con
-- is_active=true y DESPUÉS desactivan los viejos. Con el índice puesto, ese
-- insert viola la restricción y el usuario recibe "No se pudo guardar el plan"
-- al regenerar su rutina — un fallo provocado por actualizar el servidor, no
-- por nada que él hiciera.
--
-- El código nuevo no lo necesita: activate_training_plan inserta inactivo,
-- desactiva y activa dentro de la misma transacción, así que el invariante se
-- cumple por construcción. Nada más en el esquema depende del índice: todas
-- las lecturas usan "order by generated_at desc limit 1".
--
-- Se añade cuando el build 13 sea el suelo instalado:
--   create unique index if not exists one_active_training_plan_per_user
--     on public.training_plans(user_id) where is_active;

alter table public.food_logs add column if not exists xp_credited_at timestamptz;
alter table public.body_scans add column if not exists xp_credited_at timestamptz;
alter table public.workout_sessions add column if not exists xp_credited_at timestamptz;
alter table public.workout_sessions add column if not exists client_session_key uuid;
create unique index if not exists workout_session_idempotency
  on public.workout_sessions(user_id,client_session_key) where client_session_key is not null;
alter table public.set_logs add column if not exists rir numeric(3,1) check (rir between 0 and 10);
-- ÍNDICE RETIRADO. Rechazaba series LEGÍTIMAS y hacía imposible guardar el
-- entrenamiento entero. El número de serie se cuenta por HUECO del día, no
-- por ejercicio: si alguien sustituye un ejercicio por otro que ya está en la
-- sesión (el modal de cambio no excluye los que ya están), los dos huecos
-- generan series 1,2,3 con el mismo nombre. Son seis series reales, no un
-- duplicado. Con el índice, el insert entero fallaba con 23505 y el reintento
-- repetía los mismos datos: el entreno se perdía para siempre, porque la app
-- no ofrece editar ni borrar una serie ya registrada.
--
-- La unicidad real la garantiza ahora normalizeCompletedSets, que renumera en
-- vez de rechazar. El índice no vuelve mientras haya builds antiguos vivos:
-- esos siguen enviando el número duplicado.
--   create unique index if not exists set_logs_session_set_unique
--     on public.set_logs(session_id,exercise_name,set_number) where session_id is not null;

create table if not exists public.workout_readiness (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  client_session_key uuid not null,
  energy integer check (energy between 1 and 5),
  sleep_quality integer check (sleep_quality between 1 and 5),
  soreness integer check (soreness between 1 and 5),
  stress integer check (stress between 1 and 5),
  available_minutes integer check (available_minutes between 5 and 240),
  pain_new boolean not null default false,
  recorded_at timestamptz not null default now(),
  unique(user_id,client_session_key)
);
select public._apply_owner_rls('workout_readiness');
create index if not exists readiness_user_date on public.workout_readiness(user_id,recorded_at desc);
create index if not exists analytics_ts_brin on public.analytics_events using brin(ts);
create index if not exists analytics_event_ts on public.analytics_events(event,ts desc);

create or replace function public._enforce_owned_training_reference()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.training_plan_id is not null and not exists (
    select 1 from public.training_plans p where p.id=new.training_plan_id and p.user_id=new.user_id
  ) then raise exception 'El plan no pertenece al usuario de la sesión'; end if;
  return new;
end $$;
drop trigger if exists workout_session_owned_plan on public.workout_sessions;
create trigger workout_session_owned_plan before insert or update of user_id,training_plan_id
on public.workout_sessions for each row execute function public._enforce_owned_training_reference();

create or replace function public._enforce_owned_session_reference()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.session_id is not null and not exists (
    select 1 from public.workout_sessions w where w.id=new.session_id and w.user_id=new.user_id
  ) then raise exception 'La sesión no pertenece al usuario de la fila'; end if;
  return new;
end $$;
drop trigger if exists set_log_owned_session on public.set_logs;
create trigger set_log_owned_session before insert or update of user_id,session_id
on public.set_logs for each row execute function public._enforce_owned_session_reference();

create or replace function public.activate_training_plan(p_plan_data jsonb,p_change_reason jsonb default '{}'::jsonb)
returns setof public.training_plans language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_parent uuid; v_new uuid; v_week integer:=1;
begin
  if v_uid is null then raise exception 'Se requiere autenticación'; end if;
  if jsonb_typeof(p_plan_data)<>'object' or jsonb_array_length(coalesce(p_plan_data->'days','[]'::jsonb))<>7
    then raise exception 'El plan debe contener exactamente 7 días'; end if;
  select p.id,coalesce(p.week_number,0)+1 into v_parent,v_week from public.training_plans p
    where p.user_id=v_uid and p.is_active order by p.generated_at desc limit 1 for update;
  insert into public.training_plans(user_id,week_number,plan_data,is_active,parent_plan_id,change_reason)
    values(v_uid,coalesce(v_week,1),p_plan_data,false,v_parent,coalesce(p_change_reason,'{}'::jsonb)) returning id into v_new;
  update public.training_plans set is_active=false,replaced_at=now() where user_id=v_uid and is_active;
  update public.training_plans set is_active=true,replaced_at=null where id=v_new;
  update public.user_profiles set current_plan_day=0,updated_at=now() where user_id=v_uid;
  return query select p.* from public.training_plans p where p.id=v_new;
end $$;
grant execute on function public.activate_training_plan(jsonb,jsonb) to authenticated;

create or replace function public.restore_previous_training_plan()
returns setof public.training_plans language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_current uuid; v_previous uuid;
begin
  if v_uid is null then raise exception 'Se requiere autenticación'; end if;
  select p.id,p.parent_plan_id into v_current,v_previous from public.training_plans p
    where p.user_id=v_uid and p.is_active order by p.generated_at desc limit 1 for update;
  if v_current is null then raise exception 'No hay plan activo'; end if;
  -- parent_plan_id es una columna que el propio usuario puede escribir vía
  -- PostgREST, y esta función es SECURITY DEFINER (sin RLS). Si se confía en
  -- ella sin comprobar el dueño, apuntarla al plan de otra persona hacía que
  -- la respuesta devolviera su rutina completa. Se re-valida la propiedad.
  if v_previous is not null and not exists (
    select 1 from public.training_plans p where p.id=v_previous and p.user_id=v_uid
  ) then v_previous := null; end if;
  if v_previous is null then select p.id into v_previous from public.training_plans p
    where p.user_id=v_uid and p.id<>v_current order by p.generated_at desc limit 1; end if;
  if v_previous is null then raise exception 'No hay un plan anterior para restaurar'; end if;
  -- Desactivar DESPUÉS de saber que hay un plan válido al que volver: antes se
  -- desactivaba primero y, si la activación no afectaba filas, la persona se
  -- quedaba sin ningún plan activo.
  update public.training_plans set is_active=false,replaced_at=now() where id=v_current and user_id=v_uid;
  update public.training_plans set is_active=true,replaced_at=null where id=v_previous and user_id=v_uid;
  update public.user_profiles set current_plan_day=0,updated_at=now() where user_id=v_uid;
  return query select p.* from public.training_plans p where p.id=v_previous and p.user_id=v_uid;
end $$;
grant execute on function public.restore_previous_training_plan() to authenticated;

create or replace function public.complete_workout_session(
  p_client_session_key uuid,p_training_plan_id uuid,p_day_index integer,
  p_started_at timestamptz,p_completed_at timestamptz,p_duration_min integer,p_sets jsonb
)
returns table(session_id uuid,exercises_completed integer,sets_saved integer,already_completed boolean)
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_session uuid; v_exercises integer; v_sets integer; v_duration integer;
begin
  if v_uid is null then raise exception 'Se requiere autenticación'; end if;
  if p_client_session_key is null then raise exception 'Falta la clave idempotente'; end if;
  if p_day_index not between 0 and 6 then raise exception 'Día de plan inválido'; end if;
  if p_started_at is null or p_completed_at is null or p_completed_at<p_started_at then raise exception 'Rango temporal inválido'; end if;
  if p_completed_at>now()+interval '10 minutes' then raise exception 'Fecha de cierre futura'; end if;
  if p_started_at<p_completed_at-interval '24 hours' then raise exception 'Sesión demasiado extensa'; end if;
  v_duration:=greatest(1,least(1440,floor(extract(epoch from (p_completed_at-p_started_at))/60)::integer));
  if jsonb_typeof(p_sets)<>'array' or jsonb_array_length(p_sets)=0 then raise exception 'La sesión necesita al menos una serie real'; end if;
  if not exists(select 1 from public.training_plans p where p.id=p_training_plan_id and p.user_id=v_uid)
    then raise exception 'Plan inexistente o ajeno'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_session_key::text,0));
  select w.id into v_session from public.workout_sessions w
    where w.user_id=v_uid and w.client_session_key=p_client_session_key;
  if v_session is not null then
    select count(*),count(distinct l.exercise_name) into v_sets,v_exercises from public.set_logs l where l.session_id=v_session;
    return query select v_session,v_exercises,v_sets,true; return;
  end if;
  if exists(
    select 1 from jsonb_to_recordset(p_sets) as x(exercise_name text,set_number integer,weight_kg numeric,reps integer,rir numeric)
    where nullif(btrim(x.exercise_name),'') is null or length(x.exercise_name)>200
      or x.set_number is null or x.set_number not between 1 and 100
      or x.reps is null or x.reps not between 1 and 1000
      or (x.weight_kg is not null and x.weight_kg not between 0 and 1000)
      or (x.rir is not null and x.rir not between 0 and 10)
  ) then raise exception 'Hay una serie inválida'; end if;
  select count(distinct btrim(x.exercise_name)),count(*) into v_exercises,v_sets
    from jsonb_to_recordset(p_sets) as x(exercise_name text);
  insert into public.workout_sessions(user_id,training_plan_id,day_index,started_at,completed_at,duration_min,exercises_completed,client_session_key)
    values(v_uid,p_training_plan_id,p_day_index,p_started_at,p_completed_at,v_duration,v_exercises,p_client_session_key)
    returning id into v_session;
  insert into public.set_logs(user_id,session_id,exercise_name,set_number,weight_kg,reps,rir,logged_at)
    select v_uid,v_session,btrim(x.exercise_name),x.set_number,x.weight_kg,x.reps,x.rir,p_completed_at
    from jsonb_to_recordset(p_sets) as x(exercise_name text,set_number integer,weight_kg numeric,reps integer,rir numeric);
  return query select v_session,v_exercises,v_sets,false;
end $$;
grant execute on function public.complete_workout_session(uuid,uuid,integer,timestamptz,timestamptz,integer,jsonb) to authenticated;

drop function if exists public.apply_activity_stats(text,integer,text[],boolean,integer);
drop function if exists public.apply_activity_stats(text,integer,text[],boolean,integer,uuid,date);
create or replace function public.apply_activity_stats(
  p_kind text,p_xp_delta integer,p_badges text[] default '{}',p_macro_perfect boolean default false,
  p_base_xp integer default null,p_evidence_id uuid default null,p_local_day date default null
)
returns table(total_xp integer,level integer,total_meals_logged integer,total_macro_perfect_days integer,
  total_body_scans integer,earned_badges text[],macro_day_counted boolean)
language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid:=auth.uid(); v_claimed boolean:=false; v_xp integer:=0; v_streak integer;
  v_sessions integer; v_meals integer; v_macro_days integer; v_scans integer;
  v_old_badges text[]; v_claimed_missions text[]; v_key text;
  v_day date:=coalesce(p_local_day,current_date); v_dia_evidencia date; v_derived text[]; v_fresh text[];
  v_badge_xp integer:=0; v_macro_counted boolean:=false;
begin
  if v_uid is null then raise exception 'Se requiere autenticación'; end if;
  if p_kind not in ('meal','body_scan') then raise exception 'Actividad inválida'; end if;
  if v_day<current_date-1 or v_day>current_date+1 then v_day:=current_date; end if;
  -- El margen de ±1 día es necesario para las zonas horarias, pero convertía
  -- el día en un parámetro ELEGIBLE por el cliente: había tres claves
  -- 'macroday:' válidas a la vez, y como cada una es un cerrojo independiente,
  -- el bonus de 50 XP y el contador de días perfectos se podían cobrar tres
  -- veces en la misma jornada. El cerrojo se ancla ahora al día de la
  -- EVIDENCIA (la fila de comida) más abajo, no al día que diga el cliente.
  insert into public.user_stats(user_id) values(v_uid) on conflict(user_id) do nothing;
  select coalesce(s.current_streak,0),coalesce(s.total_workouts,0),coalesce(s.total_meals_logged,0),
    coalesce(s.total_macro_perfect_days,0),coalesce(s.total_body_scans,0),
    coalesce(s.earned_badges,'{}'::text[]),coalesce(s.claimed_missions,'{}'::text[])
  into v_streak,v_sessions,v_meals,v_macro_days,v_scans,v_old_badges,v_claimed_missions
  from public.user_stats s where s.user_id=v_uid for update;
  if p_kind='meal' then
    update public.food_logs f set xp_credited_at=now()
      where f.id=coalesce(p_evidence_id,(select x.id from public.food_logs x where x.user_id=v_uid and x.xp_credited_at is null
        order by x.logged_at desc limit 1 for update skip locked)) and f.user_id=v_uid and f.xp_credited_at is null
      returning (f.logged_at at time zone 'UTC')::date into v_dia_evidencia;
  else
    update public.body_scans b set xp_credited_at=now()
      where b.id=coalesce(p_evidence_id,(select x.id from public.body_scans x where x.user_id=v_uid and x.xp_credited_at is null
        order by x.scanned_at desc limit 1 for update skip locked)) and b.user_id=v_uid and b.xp_credited_at is null;
  end if;
  v_claimed:=found;
  if not v_claimed then
    return query select s.total_xp,s.level,s.total_meals_logged,s.total_macro_perfect_days,s.total_body_scans,s.earned_badges,false
      from public.user_stats s where s.user_id=v_uid; return;
  end if;
  if p_kind='meal' then
    -- El cerrojo se ancla a la fecha de la EVIDENCIA (la fila de comida que
    -- acabamos de marcar), no al día que mande el cliente: si dependiera de
    -- p_local_day, el margen de ±1 día daría tres claves válidas a la vez y
    -- el bonus se podría cobrar tres veces la misma jornada. A cambio, en
    -- husos alejados de UTC el corte del día cae a media tarde local; es un
    -- desfase conocido y preferible a un cerrojo que el cliente elige.
    v_meals:=v_meals+1; v_xp:=15;
    v_key:='macroday:'||to_char(coalesce(v_dia_evidencia,v_day),'YYYY-MM-DD');
    if p_macro_perfect and not(v_key=any(v_claimed_missions)) then
      v_macro_counted:=true; v_macro_days:=v_macro_days+1; v_xp:=v_xp+50;
      v_claimed_missions:=array_append(v_claimed_missions,v_key);
    end if;
  else v_scans:=v_scans+1; v_xp:=40; end if;
  v_derived:=public._derive_badges(v_streak,v_sessions,v_meals,v_macro_days,v_scans);
  select coalesce(array_agg(b),'{}'::text[]) into v_fresh from unnest(v_derived) b where not(b=any(v_old_badges));
  if array_length(v_fresh,1)>0 then select coalesce(sum(c.xp),0) into v_badge_xp from public.badge_catalog c where c.id=any(v_fresh); end if;
  update public.user_stats s set total_xp=coalesce(s.total_xp,0)+v_xp+v_badge_xp,
    level=floor(sqrt((coalesce(s.total_xp,0)+v_xp+v_badge_xp)/100.0))::integer+1,
    total_meals_logged=v_meals,total_macro_perfect_days=v_macro_days,total_body_scans=v_scans,
    earned_badges=v_old_badges||v_fresh,claimed_missions=v_claimed_missions,updated_at=now()
    where s.user_id=v_uid;
  return query select s.total_xp,s.level,s.total_meals_logged,s.total_macro_perfect_days,s.total_body_scans,
    s.earned_badges,v_macro_counted from public.user_stats s where s.user_id=v_uid;
end $$;
grant execute on function public.apply_activity_stats(text,integer,text[],boolean,integer,uuid,date) to authenticated;

-- Reemplaza la acreditación de entrenamiento: fecha y XP salen de evidencia
-- del servidor; un reintento no modifica ni racha ni contadores.
create or replace function public.apply_workout_stats(
  p_xp_delta integer default null,p_workout_date date default null,p_badges text[] default '{}',
  p_base_xp integer default null,p_session_id uuid default null
)
returns table(current_streak integer,longest_streak integer,total_xp integer,level integer,
  total_workouts integer,earned_badges text[],streak_freezes integer)
language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid:=auth.uid(); v_date date; v_last date; v_streak integer; v_freezes integer;
  v_gap integer; v_margin integer; v_new_streak integer; v_freeze_used boolean:=false;
  v_sessions integer; v_meals integer; v_macro_days integer; v_scans integer;
  v_old_badges text[]; v_derived text[]; v_fresh text[]; v_badge_xp integer:=0; v_xp integer:=0;
begin
  if v_uid is null then raise exception 'Se requiere autenticación'; end if;
  if p_session_id is not null then
    update public.workout_sessions w set xp_credited_at=now()
      where w.id=p_session_id and w.user_id=v_uid and w.completed_at is not null and w.xp_credited_at is null
      returning w.completed_at::date into v_date;
  else
    update public.workout_sessions w set xp_credited_at=now()
      where w.id=(select x.id from public.workout_sessions x where x.user_id=v_uid and x.completed_at is not null
        and x.xp_credited_at is null order by x.completed_at desc limit 1 for update skip locked)
      returning w.completed_at::date into v_date;
  end if;
  insert into public.user_stats(user_id) values(v_uid) on conflict(user_id) do nothing;
  -- El día de la RACHA es el día LOCAL de la persona, no el UTC del cierre.
  -- La versión anterior usaba coalesce(p_workout_date, current_date); esta lo
  -- sacaba solo de completed_at::date, que en UTC-5 adelanta un día cualquier
  -- entreno posterior a las 19:00 locales. Efecto real: a quien entrena de
  -- noche se le abrían huecos de un día de más, se le rompía la racha o se le
  -- gastaba un comodín por entrenar EXACTAMENTE el día que su plan pedía.
  -- p_workout_date sigue siendo una PROPUESTA del cliente, así que solo se
  -- acepta si cae a un día de distancia de la fecha real de la sesión: eso
  -- cubre cualquier zona horaria del mundo sin dejar elegir la fecha.
  if v_date is not null and p_workout_date is not null
     and abs(p_workout_date - v_date) <= 1 then
    v_date := p_workout_date;
  end if;

  if v_date is null then
    return query select s.current_streak,s.longest_streak,s.total_xp,s.level,s.total_workouts,s.earned_badges,s.streak_freezes
      from public.user_stats s where s.user_id=v_uid; return;
  end if;
  select s.last_workout_date,coalesce(s.current_streak,0),coalesce(s.streak_freezes,0),
    coalesce(s.total_workouts,0),coalesce(s.total_meals_logged,0),coalesce(s.total_macro_perfect_days,0),
    coalesce(s.total_body_scans,0),coalesce(s.earned_badges,'{}'::text[])
  into v_last,v_streak,v_freezes,v_sessions,v_meals,v_macro_days,v_scans,v_old_badges
  from public.user_stats s where s.user_id=v_uid for update;
  v_margin:=public._max_rest_gap(v_uid);
  if v_last is null then v_new_streak:=1;
  else
    v_gap:=v_date-v_last;
    if v_gap<=0 then v_new_streak:=v_streak;
    elsif v_gap<=v_margin then v_new_streak:=v_streak+1;
    elsif v_freezes>0 and v_gap<=8 then v_new_streak:=v_streak+1; v_freeze_used:=true;
    else v_new_streak:=1; end if;
  end if;
  v_xp:=75+case when v_new_streak>=7 then 50 when v_new_streak>=3 then 25 else 0 end;
  v_sessions:=v_sessions+1;
  v_derived:=public._derive_badges(v_new_streak,v_sessions,v_meals,v_macro_days,v_scans);
  select coalesce(array_agg(b),'{}'::text[]) into v_fresh from unnest(v_derived) b where not(b=any(v_old_badges));
  if array_length(v_fresh,1)>0 then select coalesce(sum(c.xp),0) into v_badge_xp from public.badge_catalog c where c.id=any(v_fresh); end if;
  update public.user_stats s set current_streak=v_new_streak,
    longest_streak=greatest(coalesce(s.longest_streak,0),v_new_streak),
    total_xp=coalesce(s.total_xp,0)+v_xp+v_badge_xp,
    level=floor(sqrt((coalesce(s.total_xp,0)+v_xp+v_badge_xp)/100.0))::integer+1,
    total_workouts=v_sessions,earned_badges=v_old_badges||v_fresh,
    last_workout_date=greatest(coalesce(s.last_workout_date,v_date),v_date),
    streak_freezes=greatest(coalesce(s.streak_freezes,0)-case when v_freeze_used then 1 else 0 end,0),updated_at=now()
  where s.user_id=v_uid;
  return query select s.current_streak,s.longest_streak,s.total_xp,s.level,s.total_workouts,s.earned_badges,s.streak_freezes
    from public.user_stats s where s.user_id=v_uid;
end $$;
grant execute on function public.apply_workout_stats(integer,date,text[],integer,uuid) to authenticated;
