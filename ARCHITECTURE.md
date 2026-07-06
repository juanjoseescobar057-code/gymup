# Arquitectura de GymUp

Evaluación honesta contra las prácticas de la industria móvil, **traducidas al stack real
(React Native + Expo + expo-router + Zustand + Supabase)**. Los patrones nativos
(Clean/MVVM/MVI, módulos Gradle, App Clips) tienen equivalentes RN — usar el equivalente
correcto ES la mejor práctica; copiar la forma nativa en RN es cargo-cult.

## Capas (mapeo a Clean Architecture)

| Capa Clean | En GymUp | Regla |
|---|---|---|
| **Presentation (View)** | `app/*` (pantallas expo-router) + `Components/*` | Solo UI y orquestación. Sin reglas de negocio. |
| **Presentation (ViewModel)** | `store/userStore.ts` (Zustand) + hooks de pantalla | Estado observable; las pantallas se suscriben por selector. |
| **Domain (use cases + entities)** | `lib/*Math.ts`, `lib/prs.ts`, `lib/macros.ts`, `lib/goalMath.ts`, `lib/plates.ts`, `lib/subscription.ts` (gates), `lib/pose/*` | **PUROS**: sin imports de RN ni Supabase → testeables con `node --test` (73 tests). |
| **Data (repositories)** | `lib/foodLogs.ts`, `lib/setLogs.ts`, `lib/streaks.ts`, `lib/coachContext.ts`, `lib/transformPhotos.ts`, `lib/aiClient.ts` | Único lugar que habla con Supabase/OpenAI. |
| **Infra** | `lib/supabase.ts`, `supabase/setup.sql`, Edge Functions | Config, esquema, backend. |

**Regla de dependencia** (para todo código nuevo): `app → store/lib`, `lib(dominio puro) ↛ nada`,
`lib(data) → supabase`. Las pantallas **no** deben consultar Supabase directo; si una lo hace
(legado), la refactorización se hace al tocarla, no en big-bang.

## Flujo de estado (MVVM + unidireccional estilo MVI)

`Intent` (acción del usuario) → función en `lib/` (lógica) → `set()` en el store →
re-render por suscripción. No hay estado duplicado bidireccional; los datos remotos se
hidratan al store (`hydrateTodayLogs`, `setProfile`, `setTrainingPlan`) con rollover de día.
Un MVI formal (reducers + eventos sellados) se adopta solo si el estado crece en complejidad
— hoy sería ceremonia sin beneficio.

## Modularización / Feature Modules

En RN la unidad es la **carpeta por feature**, no el módulo Gradle/SPM:
escáneres (`food-scan`, `fridge-scan`, `body-scan`), entreno (`workout-session`,
`exercises`, `history`, `workout-complete`), coach (`coach-chat`, `live-coach`, `coach` tab,
`lib/coach*`, `lib/pose/*`), gamificación (`lib/streaks*`, `lib/missions`), cuenta
(`profile`, `lib/account`), observabilidad (`lib/ai*`, `telemetry`).
**Cuándo escalar**: monorepo con paquetes (`packages/domain`, `packages/ui`) cuando haya
más de un equipo o la app supere ~50k LOC. Antes, no paga.

## Offline

Estado actual (resiliencia pragmática):
- Sesión de entreno sobrevive crash/cierre (`lib/workoutPersistence`, AsyncStorage, 3 h).
- Contadores de cupos, agua y cachés de IA en AsyncStorage (funcionan sin red).
- Fotos: si falla la subida a Storage, cae a URI local sin bloquear.
- Auth de Supabase con sesión persistida (opera offline hasta refrescar token).

**Roadmap a Offline-First real** (cuando haya usuarios): outbox en AsyncStorage para
`set_logs`/`food_logs`/`weight_entries` con flush al recuperar red (+ `@react-native-community/netinfo`),
y reglas last-write-wins por timestamp. Un motor de sync (WatermelonDB/PowerSync) solo si
aparece edición multi-dispositivo intensiva.

## Deep Links

- `scheme: "gymup"` en `app.json` + expo-router ⇒ **toda ruta ya es linkable**:
  `gymup://coach-chat`, `gymup://workout-session`, `gymup://telemetry`, etc.
- Uso previsto: notificaciones push con `url` de destino y compartir retos.
- Pendiente para producción: **App Links (Android) / Universal Links (iOS)** con dominio
  verificado (`https://gymup.app/...`) — requiere dominio + archivos `assetlinks.json` /
  `apple-app-site-association`. Va en el checklist de tiendas.

## App Clips (iOS) / Instant Apps (Android)

**Decisión: NO por ahora.** Requieren targets nativos fuera del flujo managed de Expo,
tienen límites duros de tamaño (~10-15 MB) incompatibles con RN + cámara + tflite, y su
caso de uso (experiencia sin instalar: escanear-pagar, demo de un reto) no es el core de
GymUp hoy. Se reevalúa si algún growth loop lo justifica (ej. "prueba el escáner de comida
sin instalar"). Documentado como decisión consciente, no como omisión.

## Observabilidad (construida en casa, sin terceros)

- `lib/aiMetrics.ts` (puro): tarifas por modelo, **costo exacto en USD por llamada**
  (tokens reales × precio), agregación (p95, error rate, por feature). Testeado.
- `lib/aiTelemetry.ts`: 1 fila por llamada en `ai_telemetry` (RLS por dueño): feature,
  modelo, ok/error, **latencia**, tokens in/out, costo, **nº de turno**, `decision` (los
  insumos con los que decidió el agente) y **score de calidad + bandera de alucinación**.
- `lib/aiScore.ts`: juez automático (gpt-4o-mini) que audita cada respuesta del coach:
  seguridad 40%, fidelidad a datos 25% (inventar datos del usuario ⇒ `hallucination`),
  personalización, accionabilidad, brevedad.
- `app/telemetry.tsx`: dashboard in-app (Perfil → 🔬 Telemetría IA).
- **Privacidad por diseño**: se registran métricas y contexto de decisión (números/flags),
  **nunca el contenido de los mensajes**.
- `lib/monitoring.ts`: captura de errores propia (logger); Sentry queda como opción, no
  como dependencia.

## Verificación continua

`npx tsc --noEmit` (0 errores) · `npm test` (suite pura, sin emulador) ·
`npx expo export` (bundle de producción). Correr las tres antes de cada entrega.
