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
import { execFileSync } from 'node:child_process';
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

/**
 * Una aprobación vale si dice QUIÉN, CUÁNDO, QUÉ ALCANCE y SOBRE QUÉ COMMIT.
 *
 * El commit es la parte que faltaba, y es la que la hace verificable. El
 * contenido clínico cambia con cada versión: una firma sin commit vale para
 * cualquiera de ellas, o sea para ninguna. "Lo revisó un médico" no es lo mismo
 * que "un médico revisó ESTO".
 */
function revisar(section, label) {
  const faltan = [];
  if (section?.status !== 'approved') faltan.push('status: approved');
  if (!section?.reviewer_name) faltan.push('reviewer_name');
  if (!section?.approved_at) faltan.push('approved_at');
  if (!section?.commit) faltan.push('commit revisado');
  if (!section?.scope) faltan.push('alcance');
  if (faltan.length > 0) {
    avisos.push(`${label}: pendiente (falta ${faltan.join(', ')}).`);
    return;
  }
  // Aprobada, pero ¿sobre este código? Un commit que ya no es el actual no
  // invalida la revisión, pero sí hay que saberlo antes de publicar.
  if (commitActual && section.commit !== commitActual) {
    avisos.push(
      `${label}: aprobada sobre ${section.commit}, y el commit actual es ${commitActual}. ` +
        'Revisa si lo que cambió desde entonces afecta a lo revisado.',
    );
  }
}

/** El commit del árbol de trabajo, si estamos en un repo git. */
let commitActual = null;
try {
  commitActual = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch { /* fuera de git: se comprueba lo demás igual */ }

revisar(approvals.clinical, 'Revisión clínica');
revisar(approvals.nutrition, 'Revisión de nutrición');
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

// ── El gate ──
//
// Esto SIEMPRE salía con process.exit(0). O sea: comprobaba las aprobaciones
// clínica, nutricional y legal, comprobaba las variables de Sentry, escribía
// una lista de lo que faltaba... y terminaba en verde. Un gate que no detiene
// nada es un informe con pretensiones.
//
// Ahora bloquea, PERO solo cuando se le pide de verdad. La distinción importa:
// correrlo a diario mientras se desarrolla y que falle en rojo entrena a la
// gente a ignorarlo, que es cómo un gate deja de servir por segunda vez.
//
//   npm run release:check              → informa, no bloquea (uso diario)
//   npm run release:check -- --gate    → falla si queda algo pendiente
//   RELEASE_GATE=1 npm run release:check
//
// El hook de EAS y cualquier CI de publicación deben usar la forma que bloquea.
// --eas-hook cuenta como gate: lo pasa eas-build-pre-install (package.json), y
// un build que se está haciendo PARA PUBLICAR es justo donde esto debe morder.
// Ese hook llevaba pasando la bandera desde siempre y el script la ignoraba.
const bloqueante =
  process.argv.includes('--gate') ||
  process.argv.includes('--eas-hook') ||
  process.env.RELEASE_GATE === '1';

if (avisos.length) {
  const cabecera = bloqueante
    ? 'NO se puede publicar todavía:'
    : 'Estado de publicación (informativo, no bloquea — usa --gate para exigirlo):';
  console.warn(`${cabecera}\n- ` + avisos.join('\n- '));
  if (bloqueante) {
    console.error(
      `\n${avisos.length} punto(s) pendientes. Cada uno se cierra en docs/release-approvals.json ` +
        'o en las variables del entorno de build.',
    );
    process.exit(1);
  }
} else {
  console.log('Revisiones clínica y legal registradas para las versiones actuales.');
}

process.exit(0);
