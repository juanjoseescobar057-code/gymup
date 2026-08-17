// scripts/check-release-readiness.mjs
// ─────────────────────────────────────────────────────────
// Informe del estado de las revisiones externas antes de publicar.
//
// INFORMA, NO BLOQUEA. Antes este script abortaba el build de producción si la
// revisión clínica y la legal no figuraban aprobadas. La intención era buena,
// pero convertía una decisión de negocio en un cerrojo técnico: el dueño del
// producto no podía publicar su propia app sin editar un JSON, y editarlo sin
// la revisión real habría dejado en el repo un registro falso de una revisión
// que nadie hizo. Decisión del dueño del producto (2026-08-05): se publica sin
// esperar a las revisiones externas, y el estado real se sigue viendo aquí.
//
// Lo que SÍ sigue fallando el build es scripts/check-secrets.mjs, porque un
// secreto filtrado no es una decisión de negocio: es un incidente.
//
// El estado de docs/release-approvals.json se mantiene fiel a la realidad. Si
// algún día la revisión ocurre, se marca ahí — y este informe dejará de avisar
// solo porque de verdad se hizo.
// ─────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const approvalsPath = path.join(root, 'docs', 'release-approvals.json');
const healthPath = path.join(root, 'lib', 'healthMath.ts');
const privacyPath = path.join(root, 'docs', 'legal', 'privacy-policy.md');
const termsPath = path.join(root, 'docs', 'legal', 'terms-of-service.md');

function leer(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

let approvals = {};
try {
  approvals = JSON.parse(leer(approvalsPath) || '{}');
} catch {
  console.warn('Aviso: docs/release-approvals.json no se pudo leer o no es JSON válido.');
}

const health = leer(healthPath);
const privacy = leer(privacyPath);
const terms = leer(termsPath);
const avisos = [];

function revisar(section, label) {
  if (section?.status !== 'approved' || !section?.reviewer_name || !section?.approved_at) {
    avisos.push(`${label}: pendiente (sin revisor ni fecha registrados).`);
  }
}

revisar(approvals.clinical, 'Revisión clínica');
revisar(approvals.legal_privacy, 'Revisión legal/privacidad');

if (approvals.clinical?.status === 'approved' && !health.includes("CLINICAL_REVIEW_STATUS = 'aprobado'")) {
  avisos.push('El JSON dice que la revisión clínica está aprobada, pero el código sigue declarándola pendiente.');
}
if (approvals.clinical?.content_version && !health.includes(`CLINICAL_CONTENT_VERSION = '${approvals.clinical.content_version}'`)) {
  avisos.push('La aprobación clínica no corresponde a la versión de contenido clínico del código.');
}
if (approvals.legal_privacy?.privacy_policy_version && !privacy.includes(`**Versión:** ${approvals.legal_privacy.privacy_policy_version}`)) {
  avisos.push('La aprobación legal no corresponde a la versión de la política de privacidad del repo.');
}
if (approvals.legal_privacy?.terms_version && !terms.includes(`**Versión:** ${approvals.legal_privacy.terms_version}`)) {
  avisos.push('La aprobación legal no corresponde a la versión de los términos del repo.');
}

// Sentry sin organización ni proyecto no rompe la app: solo hace que los
// errores de producción lleguen sin simbolicar, que es peor de diagnosticar
// pero no impide publicar.
for (const name of ['SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_AUTH_TOKEN']) {
  if (!process.env[name]) avisos.push(`Observabilidad: falta ${name}; los errores llegarán sin simbolicar.`);
}

// La clave de RevenueCat se HORNEA en el bundle al compilar. Sin ella,
// lib/purchases.ts corta en `if (!P || !API_KEY) return null` y el paywall no
// hace absolutamente nada: el botón de comprar no responde y no hay ningún
// error, ni en pantalla ni en Sentry. No se arregla configurando nada después
// del build — hay que volver a compilar.
//
// Se lee del .env del disco y no de process.env porque a este script lo lanza
// node directamente, sin que Expo haya cargado el archivo.
const claveRc = leer(path.join(root, '.env')).match(/^\s*EXPO_PUBLIC_RC_API_KEY_ANDROID\s*=\s*(.+)$/m)?.[1]?.trim();
if (!claveRc) {
  avisos.push(
    'Compras: falta EXPO_PUBLIC_RC_API_KEY_ANDROID en .env, así que este build ' +
      'saldrá con el paywall inerte (sin error visible). Ver .env.example.',
  );
}

if (avisos.length) {
  console.warn('Estado de publicación (informativo, no bloquea):\n- ' + avisos.join('\n- '));
} else {
  console.log('Revisiones clínica y legal registradas para las versiones actuales.');
}

process.exit(0);
