# GymUp Behavioral Intelligence Blueprint (GBIB) · v1.0

**La pregunta que responde**: ¿cómo conocer profundamente a cada usuario para darle la mejor
experiencia — usando sus interacciones, siempre con privacidad y consentimiento?

**La postura honesta**: la ventaja NO es tener 1.200 eventos el día uno (eso es deuda de
instrumentación: eventos sin dueño, sin uso y con superficie de privacidad). La ventaja es
la **arquitectura** — identidad unificada + envelope estricto + taxonomía gobernada +
warehouse propio — con un catálogo v1 magro que crece sin romperse. Así lo hacen de verdad
las empresas de producto: gobernanza primero, volumen después.

Todo es **nuestro**: eventos en `analytics_events` (Supabase), sin PostHog ni terceros.
SQL directo para responder cualquier pregunta; exportable a lo que sea el día que se necesite.

---

## Las capas (y su estado real)

| Capa | Estado | Dónde |
|---|---|---|
| **L0 · Identity** | ✅ v1 | `anonymous_id` (nace en el primer arranque ≈ installation_id), `session_id` (rota a 30 min de inactividad), `user_id` (se une al hacer flush), `seq` (orden intra-sesión) |
| **L1 · Acquisition** | 🟡 v0.5 | Deep link inicial con UTM/gclid/fbclid capturado una vez (`acquisition_captured`) + `first_open_ts`. Atribución de instalación completa (qué anuncio/creativo) requiere MMP (AppsFlyer/Adjust) → fase de paid ads |
| **L2 · Device** | ✅ v1 | `context` por evento: plataforma, OS, versión de app, pantalla, dark mode, locale, timezone. (Batería/carrier requieren módulos nativos → solo si una hipótesis lo pide) |
| **L3 · Session** | ✅ v1 | `session_start` + rotación por inactividad + flush al ir a background |
| **L4 · Navigation** | ✅ v1 | `screen_viewed` automático en cada cambio de ruta (con `from`): secuencias, caminos a retención/abandono, tiempo por pantalla derivable de eventos consecutivos |
| **L5 · Feature events** | ✅ v1 | Catálogo core-loop abajo; agregar un evento = 1 línea `track()` |
| **L6 · AI Intelligence** | ✅ v1.5 | `ai_telemetry` (ya construida): costo exacto, latencia, turnos, decisión, score, alucinaciones, intención, sentimiento, context pressure, ficha por conversación |
| **L7 · Engagement** | ✅ derivable | Rachas/XP/misiones ya viven en `user_stats`; retención D1/D7/D30 se deriva por SQL de `analytics_events` |
| **L8 · Behavioral features** | 🟡 SQL views | Variables calculadas sobre los eventos (ejemplos abajo). Se materializan cuando haya volumen |
| **L9 · Psychology scores** | ⏳ fase 2 | Consistencia, sensibilidad a recompensas, hora favorita — REGLA: solo rasgos de uso/hábito, jamás atributos sensibles |
| **L10 · Experimentation** | ⏳ fase 2 | Campo `props.experiment_id` reservado en el envelope; infra de flags cuando haya usuarios que segmentar |
| **L11 · Prediction** | ⏳ fase 3 | Churn/LTV requieren cientos de usuarios; las features de L8 son el insumo |
| **L12 · Personalization** | ✅ parcial | El coach YA personaliza con ficha+memoria; cerrar el loop con L8 (ej. hora favorita → hora de push) es fase 2 |

## Reglas de oro (adaptadas y vigentes)

1. **Nunca bloquear la UI por analítica** (encolar es síncrono; enviar es por lotes).
2. **Offline-safe**: la cola persiste en AsyncStorage y se reintenta (tope 500 — tradeoff
   explícito de almacenamiento vs "nunca perder un evento").
3. Todo evento lleva **anonymous_id + session_id + seq + client_ts UTC + screen + context**.
4. El recorrido completo es reconstruible: pre-registro (anonymous) se une al user al crear
   cuenta (los eventos esperan en cola y se envían con `user_id`).
5. **Naming**: `dominio_accion` en snake_case, en pasado (`workout_completed`). Nada de
   nombres ad-hoc: nuevo evento ⇒ fila en el catálogo de este doc.
6. Solo se agrega, no se renombra (versionar con `props.v` si cambia el significado).
7. **Privacidad**: props de producto (números/flags/etiquetas). NUNCA texto libre del
   usuario, fotos, ni inferencia de atributos sensibles (religión, orientación, salud
   ajena al fitness, política, etnia). El usuario puede borrar TODO (delete-account wipea
   `analytics_events` por cascade + tabla listada en la Edge Function).
8. Cada evento debe poder responder: ¿qué hizo, en qué contexto, desde dónde y con qué resultado?

## Catálogo v1 (core loop instrumentado hoy)

| Evento | Props | Responde |
|---|---|---|
| `session_start` | (context) | Frecuencia, horarios, DAU/WAU |
| `session_ended` | duration_sec, screens, events | **Duración real de sesión** (cierre perezoso: sobrevive kills) |
| `screen_viewed` | from, **from_duration_ms** | Navegación + **dwell time por pantalla** (dónde duda) |
| `acquisition_captured` | utm_*, had_deeplink, first_open_ts | De dónde vino (v0.5) |
| `onboarding_completed` | goal, activity_level, has_target_weight, has_nickname | Activación + calidad del signup |
| `workout_started` | day_index, exercises | Inicio del hábito |
| `set_completed` | exercise, set, weight_kg | Densidad de esfuerzo real |
| `workout_completed` | day_index, duration_min, sets_logged | EL evento de retención |
| `workout_abandoned` | sets_logged, duration_min | **Fricción**: empezó y no terminó (¿en qué punto se rinde?) |
| `food_added` | calories, protein_g, portion | Hábito nutricional |
| `scan_started` / `scan_failed` | type | Funnel del escáner (el drop-off vive aquí) |
| `weight_logged` | — | Compromiso con la meta |
| `goal_set` | removed, has_why | Profundidad de intención |
| `coach_message_sent` | turn, from_chip | Adopción del coach |
| `paywall_viewed` / `paywall_dismissed` | seconds_open | Funnel + **cuánto dudó antes de cerrar** (señal de pricing) |
| `purchase_started` / `purchase_completed` | plan | Monetización |
| `push_opened` | title | Qué notificaciones REALMENTE traen de vuelta |

**Agregar un evento** = `track('badge_earned', { badge_id })` donde ocurre + una fila aquí.
Candidatos v1.2: `exercise_swapped`, `mission_claimed`, `badge_earned`,
`streak_freeze_bought`, `notification_permission`, `live_coach_started`, `photo_added`,
`plan_regenerated`, `error_shown`.

## Feature store: `v_user_traits` (L8 ✅)

Vista SQL (security_invoker: cada quien ve solo su fila) que materializa el **vector de
rasgos por usuario** — el insumo directo de segmentación y de los futuros modelos:

`sessions_7d · avg_session_min_30d · workouts_7d/30d · habit_hour · habit_dow ·
food_days_7d · coach_msgs_7d · paywall_views_30d · workouts_abandoned_30d ·
days_since_last_workout · churn_risk (nuevo/bajo/medio/alto, por reglas transparentes) ·
engagement_score (0-100 ponderado)`

Visible en la app (Telemetría → 🧬 Perfil conductual) y consultable por SQL para segmentar:
```sql
-- ¿A quién mando el push de reactivación hoy?
select user_id from v_user_traits where churn_risk in ('medio','alto');
```
Cuando haya volumen: materializar con pg_cron y versionar los pesos del score. Los modelos
de churn/LTV (L11) se entrenan sobre ESTAS columnas — el puente ya está tendido.

## Behavioral features (L8) — ejemplos listos para correr en SQL

```sql
-- Activation delay: minutos de primer open a onboarding completado
select user_id,
  extract(epoch from (min(client_ts) filter (where event='onboarding_completed')
                    - min(client_ts))) / 60 as activation_delay_min
from analytics_events group by user_id;

-- Hora favorita de entreno (para programar el push perfecto)
select user_id, mode() within group (order by extract(hour from client_ts)) as habit_hour
from analytics_events where event='workout_completed' group by user_id;

-- Retención D7: ¿volvió a entrenar entre el día 7 y 8 desde su primer entreno?
with first_w as (select user_id, min(client_ts) f from analytics_events
                 where event='workout_completed' group by user_id)
select f.user_id, exists(select 1 from analytics_events e
  where e.user_id=f.user_id and e.event='workout_completed'
  and e.client_ts between f.f + interval '7 days' and f.f + interval '8 days') as d7
from first_w f;

-- Camino al paywall: desde qué pantalla llegan los que lo ven
select props->>'from' as origen, count(*) from analytics_events
where event='screen_viewed' and screen='/paywall' group by 1 order by 2 desc;
```

## Relación con las otras dos patas de datos

- **`ai_telemetry`** = calidad/costo del agente (juez, alucinaciones, presión, conversaciones).
- **`analytics_events`** = comportamiento de producto (este doc).
- **`user_stats` + dominio** = verdad de negocio (rachas, PRs, comidas).
Se cruzan por `user_id` (+ tiempo): ej. *¿los usuarios cuyo coach puntúa >85 retienen más?*
— esa consulta ya es posible hoy.

## Roadmap honesto

- **Fase 1 (hoy)** ✅: identidad, warehouse, navegación, core loop, adquisición por deep link.
- **Fase 1.1**: candidatos v1.1 + evento de errores + permisos.
- **Fase 2** (con beta pública): experiments (`experiment_id`), features L8 como vistas
  materializadas, primeros scores de hábito, push personalizado por `habit_hour`.
- **Fase 3** (con paid ads): MMP para atribución real de instalación, Campaign Quality Score
  (retención/LTV por campaña — optimizar por calidad, no por instalaciones).
- **Fase 4** (con volumen): modelos de churn/conversión sobre las features L8.
