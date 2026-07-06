# GymUp — Guía de despliegue a producción

Orden real, paso a paso. Cada paso dice **quién lo hace**: 🤖 (yo, ya en este repo) o
👤 (tú, porque requiere una cuenta/credencial externa a la que no tengo acceso).
🔴 = bloqueante para publicar. 🟡 = recomendado pero no bloqueante.

## Paso 0 · 🔴 Respaldo del código (👤 confirmar, 🤖 ejecutar)
Este repo tiene **un solo commit** ("Initial commit", el scaffold de Expo) — las últimas
~38 funcionalidades construidas en esta conversación **nunca se han guardado en git**.
Todo vive solo en este disco. Antes de tocar nada más:
1. Confirmarme que puedo hacer el commit (pregunto en el chat, no lo hago sin tu ok).
2. Recomendado: crear un repositorio en GitHub (privado) y subirlo — si el disco falla,
   pierdes meses de trabajo sin un remoto.

## Paso 1 · 🔴 Cuenta de Supabase correcta (👤 bloqueante)
Tu `.env.local` apunta al proyecto `rpoqsanpyciecybpaget`, pero la sesión de la CLI de
Supabase en esta máquina solo ve otros dos proyectos tuyos (`styleai`, `letraviva`) — no
GymUp. Necesito que confirmes: ¿con qué cuenta/correo de Supabase se creó el proyecto de
GymUp? Puede ser una cuenta distinta, o el proyecto pudo eliminarse por inactividad
(Supabase borra proyectos free-tier tras mucho tiempo pausados). Una vez lo confirmes:
```bash
supabase login              # con la cuenta correcta (abre el navegador)
supabase link --project-ref rpoqsanpyciecybpaget
```
Si el proyecto ya no existe, hay que crear uno nuevo y actualizar `EXPO_PUBLIC_SUPABASE_URL`
y `EXPO_PUBLIC_SUPABASE_ANON_KEY` en `.env.local`.

## Paso 2 · 🔴 Base de datos (👤 en el dashboard, o 🤖 por CLI una vez enlazado)
1. Si el proyecto está **Paused**, dale **Restore** en supabase.com.
2. SQL Editor → pega y ejecuta **todo** `supabase/setup.sql` (idempotente, fuente única
   de verdad — incluye todas las tablas: perfil, planes, comidas, series, salud,
   memoria del coach, telemetría de IA, analítica conductual, vistas de operador).
3. Authentication → Providers → activa **Anonymous sign-ins**.

## Paso 3 · 🔴 Proxy de IA + Edge Functions (🤖 una vez enlazado el proyecto)
```bash
supabase secrets set OPENAI_API_KEY=sk-...NUEVA...      # ver Paso 4
supabase functions deploy ai-proxy
supabase functions deploy delete-account
supabase functions deploy send-reactivation
supabase secrets set RC_WEBHOOK_SECRET=<aleatorio-largo>
supabase functions deploy rc-webhook --no-verify-jwt
```
Luego en `.env.local` (y en las variables de entorno del build de EAS):
```
EXPO_PUBLIC_AI_PROXY_URL=https://<REF>.functions.supabase.co/ai-proxy
```
Y **elimina** `EXPO_PUBLIC_OPENAI_API_KEY` del entorno de producción.

## Paso 4 · 🔴 Rotar la key de OpenAI (👤 obligatorio)
La key en `.env.local` viajó en builds de desarrollo. En platform.openai.com:
**revócala y crea una nueva**. Úsala SOLO en `supabase secrets` (Paso 3), nunca en el
cliente.

## Paso 5 · 🔴 Identidad visual: ícono y splash (👤 bloqueante de diseño)
**Descubrimiento importante:** `assets/icon.png`, `adaptive-icon.png` y
`splash-icon.png` son los **placeholders genéricos de Expo** (el círculo gris de
ejemplo) — nunca se reemplazaron con una marca real de GymUp. Ya conecté estos archivos
en `app.json` (ícono, ícono adaptativo de Android, splash screen), así que en cuanto
reemplaces esos 3 archivos por tu diseño real (mismos nombres, 1024×1024 px sin
transparencia para `icon.png`, con zona segura para `adaptive-icon.png`), todo
funciona sin tocar código. Esto lo necesitas antes de someter a las tiendas — un ícono
genérico es motivo de fricción en revisión y de mala primera impresión.

## Paso 6 · 🟡 Notificaciones push reales (👤 requiere cuenta de Firebase)
Google descontinuó la API legacy de FCM: Android necesita credenciales **FCM v1**
(cuenta de servicio de Firebase) subidas a EAS para que el push funcione en
producción:
1. Crea un proyecto en Firebase Console (gratis) con el mismo `package`
   (`com.gymup.app`).
2. Genera una cuenta de servicio (Configuración del proyecto → Cuentas de servicio →
   Generar clave privada).
3. `eas credentials` → Android → Push Notifications: FCM V1 service account → sube el
   JSON.
Sin esto, `registerForPushNotifications` seguirá funcionando en desarrollo pero el push
remoto fallará en producción — no bloquea publicar, sí bloquea que la reactivación
funcione.

## Paso 7 · 🔴 Legal — Privacidad y Términos (🤖 redactados, 👤 revisar y hospedar)
Ya escribí ambos documentos, específicos a lo que GymUp hace (incluye tratamiento de
**datos de salud**, procesamiento por OpenAI, pagos por RevenueCat/tiendas, derecho de
supresión):
- [`docs/legal/privacy-policy.md`](docs/legal/privacy-policy.md)
- [`docs/legal/terms-of-service.md`](docs/legal/terms-of-service.md)

**Antes de usarlos:** reemplaza los `[PLACEHOLDER]` (tu nombre/empresa, email de
contacto, ciudad) y — dado que tratas datos de salud (categoría sensible bajo la Ley
1581 de 2012) — pide que un abogado los revise. Luego necesitas una **URL pública**
para poner en las tiendas: opciones simples y gratis:
- GitHub Pages (si haces público el repo o una carpeta `docs/`, lo activo por ti).
- Notion público / una página simple en tu dominio si tienes uno.

## Paso 8 · 🟡 Monitoreo de errores (👤 crear cuenta, 🤖 conectar)
```bash
npx expo install @sentry/react-native
```
Define `EXPO_PUBLIC_SENTRY_DSN` y descomenta las líneas `// SENTRY` en
`lib/monitoring.ts` (ya preparado para esto).

## Paso 9 · Monetización — RevenueCat (👤 cuentas externas, código ya listo)
El código (`lib/purchases.ts` + `supabase/functions/rc-webhook`) ya está implementado.
Ver [`PRICING.md`](PRICING.md) para el paso a paso completo: cuentas de desarrollador
(Play Console $25 único pago / App Store $99 al año, inscribirse al **Small Business
Program** por 15% de comisión en vez de 30%), crear los productos
`gymup_premium_monthly`/`yearly`, cuenta RevenueCat con el entitlement `premium`, y las
keys `EXPO_PUBLIC_RC_API_KEY_ANDROID`/`IOS` en `.env`. **Requiere el mismo rebuild
nativo** de este paquete — agrúpalo con el Paso 10.

## Paso 10 · 🔴 Build de producción (🤖 puedo ejecutarlo, ya autenticado como `juanesco22`)
Este build incluye TODOS los módulos nativos nuevos (SecureStore, RevenueCat, el modelo
de pose): es un **rebuild real**, no solo recargar Metro.
```bash
eas build --profile production --platform android    # AAB
```
La primera vez EAS puede preguntar por un keystore de Android — puede generarlo
automáticamente. Cuando confirmes los pasos anteriores (sobre todo 1-4), lo lanzo.

## Paso 11 · 🔴 Ficha en las tiendas (👤 obligatorio)
- **Google Play → Data Safety (Seguridad de los datos):** declara explícitamente que
  recopilas **datos de salud y fitness** (el formulario de Google tiene esa categoría
  específica) — omitirlo es causa de rechazo o suspensión posterior.
- Clasificación de contenido y **edad mínima 18+**.
- URL de política de privacidad (Paso 7).
- Capturas de pantalla, descripción, ícono de la ficha (usa el ícono real del Paso 5).

## Paso 12 · Enviar a revisión
```bash
eas submit --platform android    # sube a Play (Internal Testing primero, recomendado)
```

---

## Checklist de verificación local (antes de cada build)
```bash
node ./node_modules/typescript/bin/tsc --noEmit   # 0 errores
npm test                                          # todos verdes
npx expo export --platform android                # bundle sin errores
```
(Los tres ya están verificados en el estado actual del código: 102/102 tests, 0 errores
de tipos, bundle exporta limpio con 1684 módulos.)

## Estado real ahora mismo
- ✅ Código: proxy con entitlement por feature + topes premium, borrado completo,
  RLS con `WITH CHECK`, `is_premium` blindada por columna, pagos (`purchases.ts` +
  `rc-webhook`) listos, sesión ahora cifrada en Keychain/Keystore (`LargeSecureStore`),
  ícono/splash conectados en `app.json`, legales redactados.
- 🔴 Bloqueantes que solo tú puedes resolver: cuenta de Supabase correcta (Paso 1),
  rotar la key de OpenAI (Paso 4), diseño real de ícono/splash (Paso 5), completar y
  hospedar los legales (Paso 7), cuentas de tienda + RevenueCat (Paso 9).
- 🟡 Recomendado no bloqueante: push FCM v1 (Paso 6), Sentry (Paso 8).
