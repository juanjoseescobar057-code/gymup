// __tests__/borradoLocal.test.ts
// La Edge Function delete-account borra las filas y los archivos del servidor.
// En el telefono se quedaban el tamizaje de salud en cache, la conversacion con
// el coach, la memoria destilada —con lesiones y contexto de vida dentro—, la
// sesion de entrenamiento a medias y las cuotas del dia.
//
// Varias van con el uid en la clave, asi que no se mezclan entre cuentas. Pero
// siguen FISICAMENTE en el dispositivo despues de cerrar sesion o borrar la
// cuenta, y la politica de privacidad promete borrarlo todo.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { _clasificar, _SE_CONSERVAN } from '../lib/borradoLocal';

const CLAVES_REALES = [
  'gymup_health_cache_abc',      // el tamizaje entero
  'gymup_coach_chat_v1_abc',     // la conversacion
  'gymup_memory_cache_abc',      // memoria destilada: lesiones, horarios, contexto
  'gymup_active_workout',        // sesion a medias
  'gymup_water_2026-08-23',
  'gymup_foodscan_2026-08-23',
  'gymup_plan_stale_health_abc',
  'gymup_camera_disclosure_v1_abc',
  'gymup_privacy_session_replay_v1',
];

test('se borra todo lo de la persona', () => {
  const { borrar } = _clasificar(CLAVES_REALES);
  assert.deepEqual(borrar.sort(), CLAVES_REALES.slice().sort());
});

test('el tamizaje de salud en cache no sobrevive', () => {
  // Es el dato mas sensible que guarda la app en el dispositivo.
  const { borrar } = _clasificar(['gymup_health_cache_abc']);
  assert.deepEqual(borrar, ['gymup_health_cache_abc']);
});

test('una clave NUEVA se borra sola, sin que nadie se acuerde', () => {
  // Lista blanca de lo que se conserva, no lista negra de lo que se borra: es
  // la misma decision que en las rutas del session replay, y por el mismo
  // motivo. Olvidarse tiene que ser el lado seguro.
  const { borrar } = _clasificar(['gymup_funcion_que_aun_no_existe']);
  assert.deepEqual(borrar, ['gymup_funcion_que_aun_no_existe']);
});

test('se conserva lo que no es de nadie', () => {
  // Borrar la cola de analitica perderia los eventos aun sin enviar, incluido
  // el del propio borrado de cuenta.
  const { borrar, conservar } = _clasificar([..._SE_CONSERVAN]);
  assert.deepEqual(borrar, []);
  assert.equal(conservar.length, _SE_CONSERVAN.length);
});

test('no se toca lo que no es nuestro', () => {
  // AsyncStorage lo comparten otras librerias: Supabase guarda ahi la sesion, y
  // de eso se encarga signOut.
  const ajenas = ['sb-abc-auth-token', 'expo-notifications-token', 'otra-cosa'];
  const { borrar } = _clasificar(ajenas);
  assert.deepEqual(borrar, []);
});

test('cerrar sesion y borrar cuenta llaman al borrado local', () => {
  const perfil = fs.readFileSync(path.join(process.cwd(), 'app', '(tabs)', 'profile.tsx'), 'utf8');
  const salidas = [...perfil.matchAll(/supabase\.auth\.signOut\(\)/g)];
  assert.ok(salidas.length > 0);
  for (const m of salidas) {
    assert.match(
      perfil.slice(Math.max(0, m.index! - 700), m.index!),
      /borrarDatosLocales\(\)/,
      'cada salida tiene que limpiar el dispositivo antes',
    );
  }
});

test('un fallo del almacenamiento no atrapa a nadie dentro de su cuenta', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'borradoLocal.ts'), 'utf8');
  assert.match(src, /catch \{[\s\S]{0,80}return \{ borradas: 0/);
});
