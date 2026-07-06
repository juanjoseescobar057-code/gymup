# Unit Economics y Pagos de GymUp · v1.0

Análisis de costo por usuario (tokens reales × tarifas OpenAI) para fijar el precio de la
membresía con margen sano. La telemetría propia (`ai_telemetry`) mide el costo REAL por
usuario en producción — la celda "Proyección 30 días" del dashboard valida estas cuentas
con datos vivos.

Tarifas usadas (USD por 1M tokens): **gpt-4o** $2.50 in / $10 out · **gpt-4o-mini** $0.15 / $0.60.

## 1 · Costo por acción (estimado + verificable en telemetría)

| Acción | Tokens aprox (in/out) | Modelo | Costo/uso |
|---|---|---|---|
| Escanear comida (foto) | ~1.000 / 300 | 4o | **~$0.006** |
| Escanear nevera | ~1.100 / 600 | 4o | **~$0.009** |
| Análisis corporal (3 fotos) | ~2.700 / 700 | 4o | **~$0.014** |
| Generar/adaptar plan | ~500 / 2.000 | 4o | **~$0.021** |
| Mensaje al coach (chat) | ~2.800 / 200 | 4o | ~$0.009 |
| + juez de calidad | ~1.500 / 100 | 4o-mini | +$0.0003 |
| + destilado memoria (cada 2 msgs) | ~1.000 / 300 | 4o | +$0.003 |
| **Mensaje de chat TODO incluido** | | | **~$0.012** |
| Mensaje proactivo (dashboard) | ~1.900 / 100 | 4o | ~$0.006 (máx 2/día, cacheado) |
| Coach de postura (foto) | ~1.400 / 800 | 4o | **~$0.012** |

## 2 · Costo por arquetipo de usuario / mes

| Arquetipo | Uso diario típico | Días activos/mes | Costo/mes |
|---|---|---|---|
| **Free típico** | 1-2 scans, 2 chats, 1 insight | ~12 | **~$0.45** |
| **Free al tope** (topes: 3 food, 1 fridge, 5 chat) | máximo permitido | 30 | **~$3.00** (techo absoluto) |
| **Premium típico** | 3 scans, 6 chats, insight, 1 body scan/sem | ~20 | **~$2.20** |
| **Premium intenso** | 5 scans, 12 chats, postura 2×, todo | ~26 | **~$5.50** |
| **Premium al tope anti-abuso** (nuevos límites) | 60 chat + 30 food + 30 postura + ... | 30 | ~$51 (techo teórico, humanamente impracticable) |

**Cambio implementado**: el tope premium plano de 200/feature/día era un hueco (hasta
$72/mes solo en chat). Ahora cada feature tiene tope propio (chat 60, food 30, postura 30,
nevera 10, body 5, plan 5/día) — generoso para humanos, letal para bots.

## 3 · Precio recomendado

Con precio actual **$9.99/mes** y por dónde pasa el dinero:

| Concepto | Mensual $9.99 | Anual $79.99 (≈$6.67/mes) |
|---|---|---|
| Comisión tienda (15%, Small Business Program) | −$1.50 | −$1.00/mes |
| RevenueCat | $0 (gratis hasta $2.500 MTR/mes) | $0 |
| COGS IA (premium típico→intenso) | −$2.20 a −$5.50 | igual |
| **Margen bruto** | **$3.00 – $6.30 (30-63%)** | **$0.20 – $3.50** |

**Recomendaciones concretas:**
1. **Mensual $9.99 se sostiene** (margen sano en el caso típico). No bajar de $7.99.
2. **Anual: subir a $59.99 → $4.99/mes efectivos NO alcanza** con usuarios intensos;
   mantener **$79.99** o mover a $69.99 como piso. El anual es tu mejor LTV — véndelo con
   el ahorro (33%) no con precio bajo.
3. **Colombia/LatAm**: usar los price tiers regionales de las tiendas
   (~**$24.900-29.900 COP/mes ≈ $6-7.30 USD**) — la comisión y el COGS son iguales, el
   margen baja pero la conversión local sube mucho. Decisión de mercado, no técnica.
4. **Costo free** (~$0.45 típico, $3 techo): es tu CAC orgánico. Si duele a escala, la
   palanca #1 es mover el chat free a gpt-4o-mini (–93% del costo de chat) — no lo hice
   porque el chat con 4o es el momento "wow" que convierte; revisar con datos de conversión.
5. Vigilar en telemetría la celda **Proyección 30 días** por usuario: si un free proyecta
   >$3 o un premium >$8, revisar sus topes.

## 4 · Pagos: cómo se cobra (y qué falta)

**Regla del juego**: las suscripciones digitales en apps móviles DEBEN cobrarse por
la facturación de las tiendas (Apple IAP / Google Play Billing) — política de Apple/Google;
Stripe/PayU dentro de la app para desbloquear features digitales = rechazo en revisión.
**RevenueCat** es la capa estándar sobre ambas (recibos, renovaciones, webhooks; gratis
hasta $2.500/mes de ingresos).

**Ya implementado en el código:**
- `lib/purchases.ts`: SDK real (configure con `appUserID = user_id` de Supabase, compra
  por paquete, restaurar, chequeo de entitlement al abrir). Degrada con gracia hasta el rebuild.
- `supabase/functions/rc-webhook`: webhook que escribe `is_premium` (service role) según
  eventos de RevenueCat (compra/renovación → ON; expiración → OFF).
- **Blindaje SQL**: el cliente tiene REVOCADO el UPDATE de `is_premium` a nivel de columna —
  solo el webhook puede activarlo (antes un cliente modificado podía auto-regalarse premium).
- Topes premium por feature en el proxy (sección 2).
- Eventos `purchase_started/completed/cancelled` + `paywall_dismissed` ya en la analítica.

**Pasos operativos que te tocan a ti** (en orden, ~1-2 h + esperas de las tiendas):
1. Cuentas de desarrollador: Google Play Console ($25 única vez) y/o App Store ($99/año).
   Inscribirse al **Small Business Program** de cada una (comisión 15% en vez de 30%).
2. Crear las suscripciones en cada tienda con ids `gymup_premium_monthly` y `gymup_premium_yearly`.
3. Cuenta RevenueCat → proyecto GymUp → conectar ambas tiendas → entitlement **`premium`**
   → offering `default` con los 2 paquetes.
4. Keys en `.env`: `EXPO_PUBLIC_RC_API_KEY_ANDROID=goog_...` y `EXPO_PUBLIC_RC_API_KEY_IOS=appl_...`.
5. Webhook: `supabase secrets set RC_WEBHOOK_SECRET=<aleatorio-largo>` →
   `supabase functions deploy rc-webhook --no-verify-jwt` → registrar la URL en RevenueCat
   con header `Authorization: Bearer <secreto>`.
6. **Rebuild del dev client** (react-native-purchases es nativo) — agruparlo con el rebuild
   pendiente de expo-speech.
7. Probar con sandbox/licencias de prueba de las tiendas y correr el SQL pendiente
   (`add-goal-targets.sql`, incluye el blindaje de `is_premium`).
