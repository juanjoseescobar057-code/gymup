# Cumplimiento de Google Play para GymUp (app de salud + IA)

Investigación 2025-2026, con fuentes. GymUp dispara **tres políticas simultáneas** de
Google Play por combinar: (1) datos de salud (tamizaje PAR-Q+), (2) contenido generado
por IA, y (3) fotos corporales/posturales. Ninguna app "normal" de fitness dispara las
tres a la vez — tratarlo con seriedad es lo que evita un rechazo o suspensión posterior.

> ⚠️ Varios puntos vienen de fuentes secundarias (marcado explícitamente) porque Google no
> siempre documenta con precisión byte-a-byte; verifica en pantalla al llenar cada
> formulario. Esto no sustituye asesoría legal — con datos de salud de por medio, vale la
> pena una revisión puntual con abogado antes de publicar.

## 🔴 El hallazgo de mayor riesgo: clasificación como "Medical Device"

Google introdujo en 2026 un sistema de etiquetado para apps que hacen afirmaciones tipo
diagnóstico/tratamiento reguladas. **El coach de postura por IA es el feature de mayor
riesgo de este tipo** — si el copy (en la UI o en las respuestas de la IA) suena a
"detecté una lesión" o "esto indica una desalineación estructural" en vez de "mejora tu
técnica de sentadilla", Google puede exigir certificación regulatoria (FDA/CE como
Software as a Medical Device) o forzar un re-etiquetado.

**Acción concreta**: revisar el copy exacto de `app/(tabs)/coach.tsx` y del prompt de
`analyzePosture()` para que quede inequívocamente del lado de "coaching de técnica de
entrenamiento", nunca "evaluación médica". (Fuente: lectura de riesgo basada en el cambio
de política de enero 2026, sin ejemplo explícito de Google sobre "análisis de postura por
IA" — prudente pero no 100% certeza documental.)

## Data Safety (Seguridad de los datos) — declarar DOS tipos, no uno

Play Console → Policy → App content → Data safety. Bajo "Health and fitness" hay **dos
subtipos separados**:
- **Health info** → las respuestas del tamizaje PAR-Q+ (lesiones, condiciones, dolor de
  pecho, mareos) van AQUÍ.
- **Fitness info** → series, reps, peso levantado, entrenamientos.
- Las fotos (comida/cuerpo/postura) se declaran aparte en **Photos or videos → Photos**,
  aunque su propósito sea de salud.

Propósito de uso: marcar solo **"App functionality"** (y "Analytics" si aplica). **NO**
marcar "Advertising or marketing" para ningún dato de salud — la política de Datos
Personales y Sensibles de Google lo restringe explícitamente.

## Health apps declaration form (obligatorio desde 2024, para TODA app)

Play Console → App content → Health apps. Elegir categoría: **"Health & Fitness"** →
marcar **"Activity tracking"** y **"Nutrition/weight management"** como mínimo. El
tamizaje PAR-Q+ podría encajar en "Medical" → "Disease prevention"/"Clinical decision
support" — **zona gris no confirmada**; declarar en "Medical" puede activar mayor
escrutinio, así que si hay duda, empezar por "Health & Fitness" y ajustar si Play lo pide.

## Health Content and Services — disclaimers EN LA APP, no solo en el listing

- Descripción de la app: aclarar que **GymUp no es un dispositivo médico**, no
  diagnostica ni trata condiciones (a menos que tengan certificación SaMD).
- **Los disclaimers deben estar en el punto de uso dentro de la app** (no basta con
  ponerlos solo en la ficha de Play Store) — ya existe `MEDICAL_DISCLAIMER` en
  `lib/safety.ts`; confirmar que se muestra en cada pantalla donde la IA da consejo de
  salud/postura, no solo en el onboarding.

## AI-Generated Content — falta un mecanismo de reporte en la app

Como GymUp usa IA (OpenAI) para generar consejos, aplica esta política. Requiere:
1. Un botón/canal **dentro de la app** para reportar una respuesta de IA como ofensiva,
   dañina o incorrecta (no basta con el moderation endpoint de OpenAI — Google exige que
   el usuario tenga cómo reportar, gestionado por el desarrollador).
2. Usar esos reportes para mejorar moderación/filtrado.
3. Los mismos disclaimers de salud aplican a la salida de la IA.

**Pendiente de implementar** — no existe hoy en el código. Candidato natural: un ícono de
reporte en los mensajes del coach (`app/coach-chat.tsx`) y en los resultados de postura/
comida/cuerpo, que registre el reporte (tabla nueva o vía `ai_telemetry` existente).

## Fotos enviadas a OpenAI: ¿"collected" o "shared"?

Depende de los términos de API que tengas con OpenAI: si procesan las fotos solo como
"service provider" (sin usarlas para entrenar sus propios modelos), puede calificar como
excepción y no contar como "shared" — de lo contrario, marcar "Shared" con propósito
correspondiente. **Confirmar en el contrato/DPA de OpenAI** si tus datos de API se usan
para entrenamiento; si no está documentado, lo conservador es declarar "Shared".

## Permiso de cámara: pantalla propia ANTES del diálogo del sistema

Por ser un permiso sensible con fin de salud, Google exige una pantalla propia
explicando el porqué y qué se hace con la foto (se envía a IA de terceros) **antes** de
disparar el diálogo nativo de Android. `body-scan.tsx` ya tiene un flujo de consentimiento
(`BODY_SCAN_CONSENT`); **verificar que `food-scan.tsx`, `fridge-scan.tsx` y el coach de
postura tengan el mismo nivel de disclosure explícito**, no solo el permiso estándar.

## Otros puntos confirmados

- **Content rating (IARC)** es un trámite **separado** del Health apps declaration form —
  ambos son obligatorios, uno no sustituye al otro.
- **Política de abril 2026**: prohibido usar datos de salud sensibles para elegibilidad de
  empleo/seguros o "compartir social no autorizado" — si en el futuro GymUp agrega
  features sociales (compartir progreso, leaderboards), nunca exponer ahí datos derivados
  del tamizaje de salud sin consentimiento explícito y separado.
- **Posible requisito de cuenta de Organización** (no solo Personal) para apps con
  features de salud, con plazo hipotético 28-ene-2026 — **fuente secundaria, no
  confirmada oficialmente**; revisar en Play Console si aparece un aviso al crear la cuenta.
- La política de privacidad pública debe **nombrar explícitamente a OpenAI** como
  subprocesador de los datos de salud/fotos — ya está en
  [`docs/legal/privacy-policy.md`](privacy-policy.md).

## Checklist antes de someter a revisión

- [ ] Revisar copy de postura/coach: cero lenguaje de diagnóstico médico.
- [ ] Data Safety form: Health info + Fitness info + Photos declarados por separado.
- [ ] Health apps declaration form completado (Activity tracking + Nutrition/weight).
- [ ] Disclaimers visibles en la app en cada pantalla de consejo de salud/IA (no solo listing).
- [ ] Mecanismo de reporte de contenido de IA implementado en la app.
- [ ] Decidir "collected" vs "shared" para fotos según términos de OpenAI.
- [ ] Pantalla de consentimiento explícito antes de pedir permiso de cámara en food/fridge/postura.
- [ ] Content rating (IARC) completado por separado.
- [ ] Verificar en pantalla si se exige cuenta de Organización.

## Fuentes

- [Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Health apps declaration form](https://support.google.com/googleplay/android-developer/answer/14738291)
- [Health Content and Services policy](https://support.google.com/googleplay/android-developer/answer/16679511)
- [Health app categories](https://support.google.com/googleplay/android-developer/answer/13996367)
- [AI-Generated Content policy](https://support.google.com/googleplay/android-developer/answer/13985936)
- [Policy update, April 2026](https://support.google.com/googleplay/android-developer/answer/16926792)
- [Content Ratings (IARC)](https://support.google.com/googleplay/android-developer/answer/9898843)
- [Developer Program Policy](https://support.google.com/googleplay/android-developer/answer/16933379)
- Fuentes secundarias (verificar en pantalla): myappmonitor.com, asoworld.com sobre cambios 2026
