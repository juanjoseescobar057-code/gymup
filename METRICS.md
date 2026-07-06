# GymUp Metrics Bible · v1.0

El catálogo maestro de métricas — ideadas pensando como Netflix (tiempo/completitud),
Duolingo (hábito/rachas), Facebook (grafos de comportamiento) y Amplitude (funnels).

**Leyenda**: ✅ instrumentado hoy · 🟡 derivable YA con SQL sobre los datos que capturamos ·
⏳ definida, necesita volumen de usuarios.

---

## ⭐ North Star recomendada

**WWC — Weekly Workout Completers**: usuarios con ≥3 `workout_completed` en la semana.
Es el equivalente al "watch time" de Netflix: si crece, TODO lo demás (retención, conversión,
LTV) crece. Árbol de inputs: activación (TTV) → hábito (rachas) → fricción (abandonos) →
reactivación (comebacks). Cada sección de abajo alimenta una rama.

## 1 · Activación (los primeros 7 días deciden todo)

| Métrica | Definición | Estado |
|---|---|---|
| TTV (Time to Value) | install → primer `workout_completed` | 🟡 |
| Activation delay | primer open → `onboarding_completed` (min) | 🟡 |
| Setup depth | % que define meta de peso + apodo + porqué en onboarding | ✅ props |
| Feature breadth semana 1 | nº de features distintas usadas en 7 días (aha-moment mining) | 🟡 |
| Aha-moment candidato | acción de semana 1 que más correlaciona con retención D30 | ⏳ |

## 2 · Hábito y retención (la ciencia Duolingo)

| Métrica | Definición | Estado |
|---|---|---|
| Racha extendida/rota | `streak_extended` {streak, broken_before} por entreno | ✅ |
| Freeze economics | `streak_freeze_bought/used` — ¿los freezes salvan retención o la subsidian? | ✅ |
| **Habit Consistency Index** | 1/varianza de la hora de entreno (misma hora cada día = hábito de acero) | 🟡 |
| Días-a-hábito | días hasta 3 semanas consecutivas con 3+ entrenos | ⏳ |
| Comeback rate | `comeback` {days_away}: % de ausentes 3+ días que vuelven, y QUÉ los trajo (cruce con `push_opened` en la misma sesión) | ✅ |
| Resurrection | % de churned (14+ días) que reactivan en 30 días | 🟡 |
| Cohort D1/D7/D30 | vista `v_cohort_retention` | ✅ vista |
| Power-user curve (L28) | distribución de días activos/28 (`v_power_curve`) — la sonrisa de Facebook | ✅ vista |
| DAU/WAU/MAU + stickiness | DAU/MAU ratio | 🟡 |

## 3 · Entrenamiento micro (nuestro "watch time")

| Métrica | Definición | Estado |
|---|---|---|
| Completion % | series hechas / planificadas por sesión (`workout_completed.completion_pct`) | ✅ |
| Abandono + punto de fuga | `workout_abandoned` {sets, min}: ¿en qué serie/minuto se rinden? | ✅ |
| PR velocity | `pr_achieved` por semana — ¿progresa o se estancó? (estancamiento predice churn) | ✅ |
| Exercise rejection rate | `exercise_swapped` {from, to}: qué ejercicios odia la gente → retroalimenta los planes IA | ✅ |
| Set pace / fatiga | Δt entre `set_completed` consecutivos: ¿se alarga al final? (fatiga real) | 🟡 |
| Weekend Warrior Index | ratio entrenos finde/semana → personalizar el plan | 🟡 |
| Rest-day compliance | ¿entrena en días de descanso? (riesgo de sobreentreno / plan mal calibrado) | 🟡 |
| Duración vs estimada | duration_min vs estimated_duration_min del plan | 🟡 |

## 4 · Nutrición

| Métrica | Definición | Estado |
|---|---|---|
| Días perfectos de macros | `macro_day_perfect` (1/día máx) | ✅ |
| Scan funnel | `scan_started` → éxito/`scan_failed` → `food_added` (dónde se pierde) | ✅ |
| Meal timing map | horas de `food_added` → ventanas de notificación perfectas | 🟡 |
| Porciones ajustadas | % de `food_added` con portion ≠ 1 (¿la feature sirve?) | ✅ props |
| Adherencia proteica semanal | días con proteína ≥90% de meta / 7 | 🟡 |

## 5 · Coach IA (ya de clase mundial — ver ANALYTICS.md L6)

Costo/latencia/turnos ✅ · score de calidad + alucinaciones ✅ · intención/sentimiento ✅ ·
context pressure ✅ · degradación por turno ✅ · Maximum Intent Recovery Distance ✅. Faltantes:

| Métrica | Definición | Estado |
|---|---|---|
| **Coach Trust Index** | tendencia de msgs/semana + % de consejos con seguimiento (el coach recomendó X y el usuario lo HIZO — cruce con set_logs) | ⏳ |
| Sentiment trajectory | evolución del sentimiento por usuario a lo largo de semanas | 🟡 |
| Advice follow-through | "te recomendé 62.5kg" (memoria) vs peso real registrado después | ⏳ |

## 6 · Monetización

| Métrica | Definición | Estado |
|---|---|---|
| **Quota→Paywall→Purchase funnel** | `quota_hit` {feature} → `paywall_viewed` → `purchase_*`: QUÉ límite convierte más | ✅ |
| Pricing dwell | `paywall_dismissed.seconds_open`: duda = precio casi bien; cierre <3s = propuesta de valor no aterriza | ✅ |
| Value-before-paywall | nº de workouts/scans ANTES del primer paywall → cuándo mostrar premium | 🟡 |
| Costo por usuario proyectado | telemetría → celda "Proyección 30 días" (unit economics vivos) | ✅ |
| Free→Premium por arquetipo | conversión segmentada por `v_user_traits` (¿convierten los consistentes o los intensos?) | ⏳ |

## 7 · Viralidad y growth

| Métrica | Definición | Estado |
|---|---|---|
| Share funnel | `share_initiated` → `share_completed` {context, has_pr} — los PRs, ¿se comparten más? | ✅ |
| Push efficacy | `push_opened` {title} → sesión posterior con `workout_completed` (no aperturas: ENTRENOS causados) | 🟡 |
| **Notification Fatigue Curve** | tasa de apertura de push vs frecuencia semanal por usuario → la dosis óptima antes de quemar el canal | ⏳ |
| K-factor | invitados que activan / usuario (requiere referidos, fase 2) | ⏳ |

## 8 · Salud técnica

| Métrica | Definición | Estado |
|---|---|---|
| Errores por pantalla/feature | `error_shown` (centralizado en captureError) — ¿los errores preceden al churn? | ✅ |
| Permiso de notificaciones | `notification_permission` {granted} — el predictor #1 de retención en apps de hábito | ✅ |
| Latencia IA p95 por feature | telemetría | ✅ |

## 9 · Las que casi nadie mide (nuestra ventaja)

| Métrica | Idea | Estado |
|---|---|---|
| **Workout Momentum Score** | entrenos 7d ponderados por recencia (hoy×3, ayer×2...) — detecta el frenazo ANTES de que el streak muera | 🟡 |
| **Goal Gradient Effect** | ¿acelera el engagement al acercarse a la meta de peso? (economía conductual clásica) — engagement vs kg restantes | 🟡 |
| **"Life Happened" detector** | varianza súbita de hora de entreno + gap creciente = la vida se le atravesó → regalar freeze proactivo ANTES de romper racha | ⏳ |
| Explorer vs Executor | pantallas únicas/sesión vs profundidad repetida — dos UX distintas para dos perfiles | 🟡 |
| Context Pressure conversacional | ya implementada (única en su clase) | ✅ |
| Session Rhythm | distribución de `session_start` por hora — ¿mañanero, nocturno, almuerzo? → todo se personaliza con esto | 🟡 |

## Cadencia de operación (cuando haya usuarios)

- **Diaria**: errores nuevos, alucinaciones, costo/usuario anómalo (telemetría in-app).
- **Semanal**: WWC, cohortes (`v_cohort_retention`), power curve, funnel quota→purchase, top ejercicios rechazados.
- **Mensual**: ratio LTV/CAC por canal, sensibilidad de precio (dwell), revisar pesos de engagement_score/churn_risk con datos reales.

**Regla final**: ninguna métrica se agrega "por si acaso" — cada una debe tener una decisión
que cambiaría. Las ⏳ ya tienen sus eventos capturándose HOY: cuando haya volumen, son un
query, no un proyecto.
