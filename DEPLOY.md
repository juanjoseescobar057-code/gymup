# GymUp — Guía de despliegue a producción

Orden real, paso a paso. Cada paso dice **quién lo hace**: 🤖 (yo, ya en este repo) o
👤 (tú, porque requiere una cuenta/credencial externa a la que no tengo acceso).
🔴 = bloqueante para publicar. 🟡 = recomendado pero no bloqueante.

## Paso 0 · ✅ Respaldo del código — HECHO
Repo en GitHub (`juanjoseescobar057-code/gymup`), historial real con commits por
feature/fix. Pendiente de tu lado: confirmar que el último `git push` llegó — mi
entorno no logra sincronizar con GitHub (ni `fetch` me funciona), así que no puedo
verificarlo por mi cuenta. Corre `git log origin/master -1` o revisa en github.com.

## Paso 1 · ✅ Cuenta de Supabase correcta — HECHO
Proyecto `rpoqsanpyciecybpaget` confirmado y enlazado.

## Paso 2 · ✅ Base de datos — HECHO
`setup.sql` corrido y verificado (incluye `rc_webhook_events` y `ai_content_reports`,
agregadas en el hardening de esta sesión). Anonymous sign-ins activo.

## Paso 3 · ✅ Proxy de IA + Edge Functions — HECHO
Las 4 funciones desplegadas (`ai-proxy`, `delete-account`, `send-reactivation`,
`rc-webhook`). 🟡 **Sin confirmar todavía:** que `OPENAI_API_KEY` esté puesto en
`supabase secrets` — la app devolvió 500 "IA no configurada en el servidor" en la
última prueba. Verifica con `supabase secrets list` (o el Dashboard → Edge Functions →
Secrets) y confírmame.

## Paso 4 · ✅ Rotar la key de OpenAI — HECHO
Key vieja revocada. La variable `EXPO_PUBLIC_OPENAI_API_KEY` (cliente) fue **retirada**
de `.env.local` — el proxy cubre toda la funcionalidad, no hace falta ese fallback.

## Paso 5 · ✅ Identidad visual: ícono y splash — HECHO
Logo real de GymUp (mancuerna + flecha + pulso, monograma G+U, verde eléctrico
`#c8ff3e` sobre negro `#0e0e10`) en `assets/icon.png`, `adaptive-icon.png` y
`splash-icon.png`. Necesita un **build nuevo** (no alcanza con recargar Metro — el
ícono/splash se hornean en el binario nativo) para verse puesto en el dispositivo.

## Paso 6 · 🟡 Notificaciones push reales (👤 requiere cuenta de Firebase)
`lib/push.ts` usa `Notifications.getExpoPushTokenAsync({ projectId })` (servicio Expo
Push, no FCM directo). Aún así, EAS necesita las credenciales **FCM v1** para entregar
a dispositivos Android — Google eliminó las server keys legacy en junio 2024.

1. **Crear/vincular el proyecto Firebase**: [console.firebase.google.com](https://console.firebase.google.com)
   → Agregar proyecto → Agregar app → Android. Package name **`com.gymup.app`** (debe
   coincidir exacto con `app.json → expo.android.package`).
2. **Habilitar Cloud Messaging API (V1)**: Configuración del proyecto → Cloud
   Messaging. Si aparece deshabilitada, actívala en Google Cloud Console (puede tardar
   unos minutos en propagar).
3. **Descargar `google-services.json`**: Configuración del proyecto → General → Tus
   apps → Descargar. Colócalo en `C:\GymUp\google-services.json` (seguro de commitear,
   solo IDs públicos). Falta agregar en `app.json`:
   ```json
   "android": { "package": "com.gymup.app", "googleServicesFile": "./google-services.json" }
   ```
   (hoy `app.json` **no tiene** este campo — agrégalo cuando tengas el archivo).
4. **Generar la service account key**: Configuración del proyecto → Cuentas de
   servicio → Generar nueva clave privada. Guarda el JSON fuera del repo (privado).
5. **Subir a EAS**: `eas credentials` → Android → production → Google Service Account
   → "Set up a Google Service Account Key for Push Notifications (FCM V1)" → Upload a
   new service account key → ruta al JSON del paso 4.
6. **Verificar**: repetir `eas credentials` y confirmar que aparece configurada.
   Rebuild (`eas build --platform android --profile production`) — el
   `google-services.json` nuevo solo se aplica en un build nuevo, no en OTA update.
   Prueba con el [Push Notification Tool de Expo](https://expo.dev/notifications)
   usando un token real de la tabla `push_tokens`.

Sin esto, el push sigue funcionando en desarrollo pero fallará en producción — no
bloquea publicar, sí bloquea que la reactivación funcione.

## Paso 7 · 🟡 Legal — Privacidad y Términos (✅ redactados y hosteables, 👤 publicar)
Documentos completos, sin placeholders (responsable: Juan José Escobar,
juanjoseescobar057@gmail.com, Bogotá, Colombia), y ya convertidos a HTML autocontenido
listo para publicar:
- [`docs/legal/privacy-policy.html`](docs/legal/privacy-policy.html)
- [`docs/legal/terms-of-service.html`](docs/legal/terms-of-service.html)
- [`docs/legal/index.html`](docs/legal/index.html) (landing que enlaza ambos)

**Para publicarlos (GitHub Pages):**
1. `git push` estos 3 archivos a `main`.
2. GitHub → repo `gymup` → **Settings → Pages** → Source: **Deploy from a branch** →
   rama `main`, carpeta **/docs** → **Save**.
3. URLs públicas quedarían en:
   - `https://juanjoseescobar057-code.github.io/gymup/legal/privacy-policy.html`
   - `https://juanjoseescobar057-code.github.io/gymup/legal/terms-of-service.html`

**Importante:** GitHub Pages gratis solo funciona con el repo **público**. Si `gymup`
es privado, necesitas un plan de pago de GitHub para Pages, o hacer público el repo (o
al menos esta carpeta) antes de someter a Play Store. Verifica la visibilidad actual.

Recomendado (no bloqueante): que un abogado revise ambos documentos — tratan datos de
salud, categoría sensible bajo la Ley 1581 de 2012.

## Paso 8 · ✅ Monitoreo de errores (Sentry) — HECHO
`@sentry/react-native` instalado, DSN configurado, `lib/monitoring.ts` conectado de
verdad (con carga perezosa segura — el módulo nativo de Sentry se resuelve en el
import de nivel superior del paquete y necesita el build nativo para funcionar del
todo; hasta el próximo build queda en modo logger local sin romper nada).

## Paso 9 · 🔴 Monetización — RevenueCat (👤 cuentas externas, código ya listo)
El código (`lib/purchases.ts` + `supabase/functions/rc-webhook`) ya está implementado
y endurecido (idempotencia, orden de eventos, TRANSFER). Sigue el orden exacto — la app
y el webhook ya están escritos para estos nombres literales, no los cambies:

1. **Cuenta y proyecto**: [revenuecat.com](https://www.revenuecat.com) → crear cuenta
   → **+ Create new project** → `GymUp`. RevenueCat usa el modelo de **Projects**
   (reemplazó el viejo dropdown de "Apps").
2. **Agregar la app Android**: dentro del proyecto → Apps → + New → Android.
3. **Credenciales de Google Play**: en Google Cloud Console habilitar *Google Play
   Developer API*, *Google Play Android Developer Reporting API* y *Cloud Pub/Sub
   API*; crear un service account, darle acceso en Play Console (Users and
   permissions), y subir su JSON en RevenueCat → Project Settings → [app Android] →
   Google Play App Settings → Service account credentials. Puede tardar hasta 36h en
   activarse ("Invalid Play Store credentials" mientras tanto es normal.)
4. **Entitlement**: Product catalog → Entitlements → + New → identificador exacto
   `premium` (coincide con `PREMIUM_ENTITLEMENT` en `lib/purchases.ts`).
5. **Productos**: primero créalos como suscripciones en Play Console con estos IDs
   exactos (el código matchea con `id === planId || id.startsWith(planId + ':')`, así
   que base plans con sufijo `:tipo` también funcionan):
   ```
   gymup_premium_monthly
   gymup_premium_yearly
   ```
   Luego en RevenueCat: Product catalog → Products → + New → vincula ambos con esos
   mismos IDs, adjunta cada uno al entitlement `premium`.
6. **Offering**: Offerings → + New → identificador `default` → agrega los dos paquetes
   (monthly/annual) → márcalo **Current**.
7. **Webhook**: Project → Integrations → Webhooks → + New:
   - URL: `https://<tu-proyecto>.supabase.co/functions/v1/rc-webhook`
   - Header Authorization: `Bearer <RC_WEBHOOK_SECRET>` (mismo valor que pusiste con
     `supabase secrets set RC_WEBHOOK_SECRET=...`)
   - Eventos: deja todos habilitados, `rc-webhook/index.ts` ya filtra los que no maneja.
8. **Env vars**: Project → [app Android] → API Keys → copia la "Public app-specific
   API key" (empieza con `goog_`):
   ```
   EXPO_PUBLIC_RC_API_KEY_ANDROID=goog_xxxxx
   ```

*Nota de UI:* RevenueCat rediseñó la navegación en 2025 — las API keys ya no están en
un panel global, viven dentro de Project → Platforms/Apps.

Ver también [`PRICING.md`](PRICING.md) para cuentas de desarrollador (Play Console $25
único pago, inscribirse al Small Business Program por 15% de comisión en vez de 30%).
**Requiere el mismo rebuild nativo** de este paquete — agrúpalo con el Paso 10.

## Paso 10 · 🔴 Build de producción (🤖 puedo ejecutarlo, ya autenticado como `juanesco22`)
Este build incluye TODOS los módulos nativos (SecureStore, RevenueCat, Sentry, el
modelo de pose, `react-native-get-random-values`): es un **rebuild real**, no solo
recargar Metro.
```bash
eas build --profile production --platform android    # AAB
```
La primera vez EAS puede preguntar por un keystore de Android — puede generarlo
automáticamente. Cuando confirmes los pasos anteriores (sobre todo 6 y 9), lo lanzo.

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
  `rc-webhook` endurecido con idempotencia/orden/TRANSFER) listos, sesión cifrada en
  Keychain/Keystore, fetch nativo (no `whatwg-fetch`), manejo de error de red robusto,
  reporte de contenido de IA + disclosure de cámara (compliance Google Play), copy de
  postura sin lenguaje médico, Sentry conectado, ícono/splash reales conectados en
  `app.json`, legales redactados y ya en HTML listo para publicar.
- 🔴 Bloqueantes que solo tú puedes resolver: confirmar `OPENAI_API_KEY` en el servidor
  (Paso 3), confirmar `git push` (Paso 0), cuentas de tienda + RevenueCat (Paso 9),
  build de producción una vez lo anterior esté listo (Paso 10).
- 🟡 Recomendado no bloqueante: push FCM v1 (Paso 6), publicar los legales en GitHub
  Pages y confirmar visibilidad del repo (Paso 7), revisión de abogado.
