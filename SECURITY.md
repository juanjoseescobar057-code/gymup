# Seguridad de GymUp — mapeo OWASP Mobile (MASVS/Top 10)

Auditoría honesta: ✅ implementado · 🟡 parcial/pendiente con plan · ⚪ no aplica (decisión).

## M1 · Credenciales y secretos
- ✅ La API key de OpenAI NO se embebe en producción: proxy `ai-proxy` (Edge Function) con
  JWT del usuario; la key vive en secrets del servidor.
- ✅ `anon key` de Supabase en el cliente es pública **por diseño** (la seguridad real es RLS).
- 🟡 Pendiente operativo (DEPLOY.md): rotar la key de OpenAI usada en desarrollo antes de
  publicar, y compilar SIN `EXPO_PUBLIC_OPENAI_API_KEY`.

## M2 · Supply chain
- ✅ Lockfile (`package-lock.json`) versionado; dependencias de fuentes oficiales.
- 🟡 Añadir `npm audit` al flujo previo a release.

## M3/M4 · Autenticación y autorización
- ✅ Supabase Auth (anónimo → cuenta real con linking); JWT en cada request.
- ✅ **RLS en TODAS las tablas** con las 4 políticas y `WITH CHECK` (helper `_apply_owner_rls`).
- ✅ Entitlements **server-side** por feature (premium/cupos) + rate limit diario fail-closed.
- ✅ Storage privado: paths por `auth.uid()`, lectura por signed URLs con expiración.

## M5 · Comunicación insegura
- ✅ Solo HTTPS (Supabase/OpenAI). Sin endpoints propios en claro.
- ⚪ Certificate pinning: no viable en Expo managed sin config plugin; riesgo aceptado para
  esta clase de app (sin datos financieros). Reevaluar si se manejan pagos in-app propios.

## M6 · Privacidad
- ✅ Minimización: el análisis corporal guarda solo resultados numéricos, no fotos.
- ✅ Derecho al olvido real: borrado por tabla + Storage + identidad auth (server-side).
- ✅ Telemetría propia SIN contenido de mensajes (solo métricas y flags de decisión).
- ✅ Edad mínima 18 con consentimiento explícito; disclaimers médicos visibles.
- ✅ Memoria del coach: visible y borrable por el usuario (hecho a hecho o completa).

## M7 · Controles binarios / M8 · Configuración
- ✅ `console.*` eliminado en builds de producción (babel `transform-remove-console`).
- ✅ Aviso en runtime si una build de producción sale sin proxy configurado.
- ⚪ Root/jailbreak detection y ofuscación: no aplican al perfil de riesgo (no fintech).

## M9 · Almacenamiento local
- ✅ Datos sensibles de negocio viven en Supabase con RLS, no en el dispositivo.
- 🟡 La sesión de Supabase persiste en AsyncStorage (texto plano, sandbox del SO). Plan:
  adaptador `expo-secure-store` + cifrado AES para el token (patrón LargeSecureStore) —
  **requiere rebuild nativo**; agendado junto al próximo dev build (con expo-speech).
- ✅ Lo demás en AsyncStorage son contadores/caches no sensibles.

## M10 · Entradas y salidas
- ✅ TODA salida de IA se valida con Zod (`parseAI`) antes de tocar UI/BD — sin `JSON.parse` ciego.
- ✅ Pisos de seguridad EN CÓDIGO (no solo prompt): calorías ≥ max(BMR, 1200); % grasa clampado.
- ✅ Reglas de seguridad de IA duplicadas cliente + **re-inyectadas en el servidor** (un cliente
  modificado no puede quitarlas).
- ✅ Validación de rangos en BD (checks SQL: edad, peso, reps, scores).

## IA responsable (específico del producto)
- ✅ Charter de coach profesional (NSCA/ACSM-style) en todos los prompts: señales de alarma,
  dolor agudo, poblaciones especiales, prohibición de sustancias, opción conservadora.
- ✅ Juez de calidad automático por mensaje del coach: score + bandera de alucinación,
  auditable en el dashboard de telemetría.
