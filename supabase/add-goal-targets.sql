-- add-goal-targets.sql
-- ─────────────────────────────────────────────────────────
-- Migración puntual para bases ya creadas. Idempotente (segura de correr
-- varias veces). Ejecutar UNA vez en el SQL Editor de Supabase.
--
-- Agrega:
--   1. Meta concreta de peso + motivación ("el porqué") al perfil.
--   2. Apodo del usuario (cómo quiere que lo llame el coach).
--   3. Tabla de MEMORIA del coach IA (hechos destilados de las charlas).
--
-- Requiere que setup.sql se haya ejecutado antes (usa _apply_owner_rls).
-- ─────────────────────────────────────────────────────────

alter table if exists public.user_profiles add column if not exists target_weight_kg numeric(5,1);
alter table if exists public.user_profiles add column if not exists goal_why text;
alter table if exists public.user_profiles add column if not exists goal_start_weight_kg numeric(5,1);
alter table if exists public.user_profiles add column if not exists nickname text;

create table if not exists public.coach_memory (
  user_id uuid references auth.users(id) on delete cascade not null primary key,
  facts jsonb not null default '[]',
  updated_at timestamptz default now()
);
select public._apply_owner_rls('coach_memory');

--   4. Observabilidad propia de IA (costo, latencia, score por mensaje).
create table if not exists public.ai_telemetry (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  ts timestamptz default now(),
  feature text not null,
  model text,
  ok boolean not null default true,
  error text,
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  cost_usd numeric(10,6),
  turn_count integer,
  decision jsonb,
  score integer check (score between 0 and 100),
  hallucination boolean,
  score_reason text
);
alter table if exists public.ai_telemetry add column if not exists conversation_id text;
alter table if exists public.ai_telemetry add column if not exists signals jsonb;
select public._apply_owner_rls('ai_telemetry');
create index if not exists ai_telemetry_user_ts on public.ai_telemetry(user_id, ts desc);
create index if not exists ai_telemetry_conv on public.ai_telemetry(user_id, conversation_id);

--   5. Analítica conductual propia (warehouse de eventos de producto).
create table if not exists public.analytics_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  anonymous_id text not null,
  session_id text not null,
  seq integer,
  event text not null,
  screen text,
  props jsonb,
  context jsonb,
  client_ts timestamptz not null,
  ts timestamptz default now()
);
select public._apply_owner_rls('analytics_events');
create index if not exists analytics_user_ts on public.analytics_events(user_id, client_ts desc);
create index if not exists analytics_user_event on public.analytics_events(user_id, event);
create index if not exists analytics_session on public.analytics_events(user_id, session_id, seq);

--   6. Feature store: rasgos por usuario (hábitos, engagement, churn).
create or replace view public.v_user_traits
with (security_invoker = true) as
with base as (
  select
    p.user_id,
    p.created_at as first_seen,
    (select count(distinct e.session_id) from public.analytics_events e
      where e.user_id = p.user_id and e.client_ts > now() - interval '7 days') as sessions_7d,
    (select round(avg((e.props->>'duration_sec')::numeric) / 60, 1) from public.analytics_events e
      where e.user_id = p.user_id and e.event = 'session_ended'
        and e.client_ts > now() - interval '30 days') as avg_session_min_30d,
    (select count(*) from public.workout_sessions s
      where s.user_id = p.user_id and s.completed_at is not null
        and s.started_at > now() - interval '7 days') as workouts_7d,
    (select count(*) from public.workout_sessions s
      where s.user_id = p.user_id and s.completed_at is not null
        and s.started_at > now() - interval '30 days') as workouts_30d,
    (select mode() within group (order by extract(hour from s.started_at))
      from public.workout_sessions s
      where s.user_id = p.user_id and s.completed_at is not null) as habit_hour,
    (select mode() within group (order by extract(isodow from s.started_at))
      from public.workout_sessions s
      where s.user_id = p.user_id and s.completed_at is not null) as habit_dow,
    (select count(distinct f.logged_at::date) from public.food_logs f
      where f.user_id = p.user_id and f.logged_at > now() - interval '7 days') as food_days_7d,
    (select count(*) from public.ai_telemetry t
      where t.user_id = p.user_id and t.feature = 'coach_chat'
        and t.ts > now() - interval '7 days') as coach_msgs_7d,
    (select count(*) from public.analytics_events e
      where e.user_id = p.user_id and e.event = 'paywall_viewed'
        and e.client_ts > now() - interval '30 days') as paywall_views_30d,
    (select count(*) from public.analytics_events e
      where e.user_id = p.user_id and e.event = 'workout_abandoned'
        and e.client_ts > now() - interval '30 days') as workouts_abandoned_30d,
    (select max(s.started_at) from public.workout_sessions s
      where s.user_id = p.user_id and s.completed_at is not null) as last_workout_at
  from public.user_profiles p
)
select b.*,
  case when b.last_workout_at is null then null
       else extract(day from now() - b.last_workout_at)::int end as days_since_last_workout,
  case
    when b.last_workout_at is null then 'nuevo'
    when now() - b.last_workout_at >= interval '7 days' then 'alto'
    when now() - b.last_workout_at >= interval '4 days' and b.workouts_30d >= 3 then 'medio'
    else 'bajo'
  end as churn_risk,
  least(100, b.workouts_7d * 25 + b.food_days_7d * 8 + b.coach_msgs_7d * 4 + b.sessions_7d * 3)::int as engagement_score
from base b;
grant select on public.v_user_traits to anon, authenticated;

--   9. Eventos del webhook de RevenueCat (idempotencia/orden). Solo service role.
create table if not exists public.rc_webhook_events (
  event_id text primary key,
  user_id uuid,
  event_type text not null,
  event_timestamp_ms bigint not null,
  environment text,
  received_at timestamptz default now()
);
alter table public.rc_webhook_events enable row level security;
create index if not exists rc_webhook_events_user on public.rc_webhook_events(user_id, event_timestamp_ms desc);

--   8. Perfil de salud (tamizaje PAR-Q+: lesiones, condiciones, banderas).
create table if not exists public.health_profile (
  user_id uuid references auth.users(id) on delete cascade not null primary key,
  parq_chest_pain boolean not null default false,
  parq_dizziness boolean not null default false,
  parq_doctor_restricted boolean not null default false,
  conditions text[] not null default '{}',
  injuries text[] not null default '{}',
  other_note text,
  doctor_cleared boolean not null default false,
  cleared_at timestamptz,   -- cuándo confirmó la autorización (vigencia 12/3 meses)
  risk_level text check (risk_level in ('bajo','moderado','alto')),
  updated_at timestamptz default now()
);
alter table if exists public.health_profile add column if not exists cleared_at timestamptz;
select public._apply_owner_rls('health_profile');

--   7b. Vistas de operador (cross-usuario, sin grant al cliente).
create or replace view public.v_daily_activity as
select user_id, client_ts::date as day,
  count(*) filter (where event = 'workout_completed') as workouts,
  count(*) filter (where event = 'food_added') as foods,
  count(*) filter (where event = 'coach_message_sent') as coach_msgs,
  count(distinct session_id) as sessions
from public.analytics_events
group by 1, 2;

create or replace view public.v_cohort_retention as
with cohort as (
  select user_id, min(client_ts)::date as signup_day
  from public.analytics_events where event = 'onboarding_completed' group by 1
),
activity as (select distinct user_id, client_ts::date as day from public.analytics_events)
select date_trunc('week', c.signup_day)::date as cohort_week,
  count(distinct c.user_id) as users,
  round(100.0 * count(distinct a1.user_id) / nullif(count(distinct c.user_id), 0), 1) as d1_pct,
  round(100.0 * count(distinct a7.user_id) / nullif(count(distinct c.user_id), 0), 1) as d7_pct,
  round(100.0 * count(distinct a30.user_id) / nullif(count(distinct c.user_id), 0), 1) as d30_pct
from cohort c
left join activity a1  on a1.user_id = c.user_id and a1.day = c.signup_day + 1
left join activity a7  on a7.user_id = c.user_id and a7.day between c.signup_day + 7  and c.signup_day + 8
left join activity a30 on a30.user_id = c.user_id and a30.day between c.signup_day + 30 and c.signup_day + 32
group by 1 order by 1 desc;

create or replace view public.v_power_curve as
select active_days, count(*) as users
from (
  select user_id, count(distinct client_ts::date) as active_days
  from public.analytics_events
  where client_ts > now() - interval '28 days'
  group by 1
) t
group by 1 order by 1;

--   7. Seguridad de pagos: is_premium solo lo escribe el webhook (service role).
revoke update on public.user_profiles from anon, authenticated;
grant update (name, nickname, age, weight_kg, height_cm, goal, activity_level,
  daily_calories, daily_protein_g, daily_carbs_g, daily_fat_g,
  current_plan_day, last_active_date, target_weight_kg, goal_why,
  goal_start_weight_kg, updated_at)
  on public.user_profiles to anon, authenticated;
