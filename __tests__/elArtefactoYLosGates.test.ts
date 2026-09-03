// __tests__/elArtefactoYLosGates.test.ts
// ─────────────────────────────────────────────────────────
// Lo que sale dentro del APK, y los gates que deberían impedir publicarlo mal.
//
// De la auditoría externa (P0.6 y P0.7), verificado contra el manifest FUSIONADO
// del build, no contra el de origen:
//
//   • SYSTEM_ALERT_WINDOW — permiso para dibujar encima de otras apps. La app no
//     lo usa; Play lo mira con lupa y el usuario ve "puede aparecer sobre otras
//     aplicaciones" al instalar.
//   • READ_PHONE_STATE — no lo pide nadie del proyecto: entra desde una
//     dependencia de TFLite con target antiguo y acaba declarado en el manifest
//     final. Es el permiso que más desconfianza genera en una app de fitness.
//   • allowBackup="true" — el backup de Android se lleva los datos de la app a
//     Google Drive. Aquí eso incluye el tamizaje de salud en caché y la
//     conversación con el coach.
//   • SENTRY_DISABLE_AUTO_UPLOAD fijo en 'true' con un comentario diciendo
//     "cuando configuremos el token, esto se quita": un paso manual que nadie
//     iba a dar.
//   • check-release-readiness terminaba SIEMPRE en process.exit(0). Comprobaba
//     las aprobaciones clínica, nutricional y legal, listaba lo que faltaba, y
//     salía en verde.
//
// Los tres primeros se arreglan en app.json y NO editando android/, que
// `expo prebuild --clean` borra y regenera en cada build.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leer = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');
const app = JSON.parse(leer('app.json'));

test('los permisos que no usamos están bloqueados', () => {
  const bloqueados: string[] = app.expo.android.blockedPermissions ?? [];
  for (const p of [
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.READ_PHONE_STATE',
  ]) {
    assert.ok(bloqueados.includes(p), `${p} no está bloqueado: acaba en el manifest final`);
  }
});

test('el bloqueo va en app.json, no en android/', () => {
  // `expo prebuild --clean` borra y regenera android/ en cada build: editar el
  // manifest a mano dura hasta el siguiente prebuild.
  const plugins: string[] = app.expo.plugins.filter((p: any) => typeof p === 'string');
  assert.ok(app.expo.android.blockedPermissions, 'no hay blockedPermissions en app.json');
  assert.ok(plugins.length > 0, 'app.json perdió sus plugins');
});

test('el backup de Android está desactivado', () => {
  // Se lleva a Google Drive los datos de la app: aquí, el tamizaje de salud en
  // caché y la conversación con el coach.
  assert.equal(
    app.expo.android.allowBackup,
    false,
    'allowBackup sigue permitido: los datos de salud viajan al backup de Google',
  );
});

test('los permisos que SÍ usamos siguen ahí', () => {
  // El arreglo no puede haberse llevado la cámara por delante.
  assert.ok(
    (app.expo.android.permissions ?? []).includes('CAMERA'),
    'desapareció el permiso de cámara',
  );
});

// ── Los gates ──

test('el upload de source maps se enciende solo cuando hay credenciales', () => {
  const build = leer('scripts', 'build-android.mjs');
  assert.ok(
    !/^\s*SENTRY_DISABLE_AUTO_UPLOAD: 'true',\s*$/m.test(build),
    'sigue desactivado de forma incondicional: el día que existan las variables, seguiría sin subir',
  );
  assert.match(build, /process\.env\.SENTRY_AUTH_TOKEN && process\.env\.SENTRY_ORG/);
});

test('release:check puede bloquear de verdad', () => {
  const check = leer('scripts', 'check-release-readiness.mjs');
  assert.match(check, /process\.exit\(1\)/, 'no hay ninguna salida en error: no bloquea nada');
  assert.match(check, /--gate/);
  assert.match(check, /RELEASE_GATE/);
});

test('el hook de EAS bloquea, porque ese build es para publicar', () => {
  const check = leer('scripts', 'check-release-readiness.mjs');
  assert.match(
    check,
    /includes\('--eas-hook'\)/,
    'el hook pasa --eas-hook y el script lo ignora: publicar no comprueba nada',
  );
  // Y que el hook siga pasándola.
  const pkg = JSON.parse(leer('package.json'));
  assert.match(pkg.scripts['eas-build-pre-install'], /--eas-hook/);
});

test('el uso diario sigue sin bloquear', () => {
  // Un gate que falla en rojo cada día mientras se desarrolla entrena a la
  // gente a ignorarlo — que es cómo dejó de servir la primera vez.
  const check = leer('scripts', 'check-release-readiness.mjs');
  const i = check.indexOf('if (bloqueante)');
  assert.ok(i > 0, 'no distingue informar de bloquear');
});
