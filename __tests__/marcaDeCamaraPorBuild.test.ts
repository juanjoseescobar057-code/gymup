// __tests__/marcaDeCamaraPorBuild.test.ts
// ─────────────────────────────────────────────────────────
// La marca de "aquí la cámara de pose no funciona" caduca por BUILD.
//
// Cuando vision-camera se cae en un dispositivo, se marca y las siguientes
// sesiones van directo al modo simulado. El módulo promete —en su propio
// comentario de cabecera— que "tras una actualización se reintenta UNA vez,
// por si un fix nativo posterior lo resolvió".
//
// No se reintentaba. La marca se guardaba contra Constants.expoConfig.version,
// que es la versión de marketing: los builds 22, 23 y 24 son todos "1.3.0".
// Un teléfono marcado durante el 22 seguía yendo al modo simulado en el 23,
// aunque el arreglo nativo viniera justo en ese build. La promesa del
// comentario no se cumplía para ninguna subida que no cambiara 1.3.0 — o sea,
// para casi todas.
//
// El versionCode sí cambia en cada subida: Google no acepta el mismo dos veces.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leerCodigo = (...p: string[]) =>
  fs
    .readFileSync(path.join(process.cwd(), ...p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const soporte = leerCodigo('lib', 'pose', 'cameraSupport.ts');

test('la marca incluye el versionCode, no solo la versión de marketing', () => {
  assert.ok(
    /versionCode/.test(soporte),
    'la marca se guarda contra 1.3.0: no caduca entre builds y el reintento prometido no ocurre nunca',
  );
});

test('ni leer ni escribir la marca usan la versión de marketing a secas', () => {
  // Que exista `versionCode` en el archivo no basta: lo que importa es que sea
  // la clave que se compara y la que se guarda.
  assert.ok(
    !/getItem\(KEY\)\) === appVersion/.test(soporte),
    'la lectura sigue comparando contra la versión de marketing',
  );
  assert.ok(
    !/setItem\(KEY, appVersion\)/.test(soporte),
    'la escritura sigue guardando la versión de marketing',
  );
  assert.ok(
    /getItem\(KEY\)\) === buildActual/.test(soporte) && /setItem\(KEY, buildActual\)/.test(soporte),
    'lectura y escritura tienen que usar la MISMA clave de build, o la marca no caduca o caduca siempre',
  );
});

test('la etiqueta de versión del perfil usa el mismo criterio', () => {
  // Dos sitios distintos preguntando "¿qué build es este?" tienen que
  // responder igual, o depurar un reporte se vuelve adivinar.
  const perfil = leerCodigo('app', '(tabs)', 'profile.tsx');
  assert.ok(
    /versionCode/.test(perfil),
    'el perfil enseña 1.3.0 sin el versionCode: no sirve para saber qué build tiene un teléfono',
  );
});
