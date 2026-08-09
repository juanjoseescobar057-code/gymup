// __tests__/datosUsuario.test.ts
// Las listas de "qué se exporta" y "qué se borra" viven en archivos distintos
// y se escriben a mano. Ya se desincronizaron una vez: el export pedía
// `health_profiles` cuando la tabla real es `health_profile`, el error caía en
// la rama de "tabla opcional", se saltaba en silencio y el archivo se
// declaraba COMPLETO sin el perfil de salud. Alguien podía exportar, creer que
// tenía todo lo suyo y borrar la cuenta a continuación.
//
// Este test no consulta la base: compara las dos listas entre sí y contra el
// catálogo de tablas conocido. Es lo que faltaba para que un dedazo no vuelva
// a costar los datos de salud de una persona.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function listaDe(archivo: string, marcador: string): string[] {
  const src = fs.readFileSync(archivo, 'utf8');
  const i = src.indexOf(marcador);
  assert.ok(i >= 0, `no se encontró "${marcador}" en ${archivo}`);
  const fin = src.indexOf('];', i);
  return [...src.slice(i, fin).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

const EXPORTADAS = listaDe('lib/exportData.ts', 'const TABLAS');
const BORRADAS = listaDe('supabase/functions/delete-account/index.ts', 'const TABLES');

/**
 * Tablas que NO se exportan a propósito. Cada una necesita una razón: si algo
 * cae aquí sin justificarse, se está ocultando dato del usuario.
 */
const NO_SE_EXPORTAN: Record<string, string> = {
  push_tokens: 'identificador del dispositivo, no contenido de la persona',
  ai_usage: 'contadores de cupo, operativo',
  ai_telemetry: 'latencias y costes internos, operativo',
  ai_content_reports: 'reportes de contenido, se conservan para moderación',
  analytics_events: 'telemetría de producto, no contenido de la persona',
};

test('todo lo que se exporta también se borra', () => {
  // Al revés no: hay tablas operativas que se borran y no se exportan.
  const sinBorrar = EXPORTADAS.filter((t) => !BORRADAS.includes(t));
  assert.deepEqual(
    sinBorrar, [],
    `Se exportan pero NO se borran: ${sinBorrar.join(', ')}. Un borrado de cuenta las dejaría vivas.`,
  );
});

test('lo que se borra y no se exporta tiene una razón escrita', () => {
  const sinExportar = BORRADAS.filter((t) => !EXPORTADAS.includes(t));
  const sinJustificar = sinExportar.filter((t) => !NO_SE_EXPORTAN[t]);
  assert.deepEqual(
    sinJustificar, [],
    `Se borran pero no se exportan y sin justificar: ${sinJustificar.join(', ')}.`,
  );
});

test('el perfil de salud está en las dos listas, y en singular', () => {
  // El fallo exacto que motivó este archivo.
  assert.ok(EXPORTADAS.includes('health_profile'), 'el export tiene que llevar health_profile');
  assert.ok(BORRADAS.includes('health_profile'), 'el borrado tiene que llevar health_profile');
  assert.ok(!EXPORTADAS.includes('health_profiles'), 'plural: esa tabla no existe');
});

test('las tablas con contenido real del usuario están en las dos listas', () => {
  const CONTENIDO = [
    'user_profiles', 'training_plans', 'workout_sessions', 'set_logs',
    'food_logs', 'body_scans', 'weight_entries', 'transform_photos',
    'health_profile', 'posture_feedback', 'coach_memory', 'user_stats',
  ];
  for (const t of CONTENIDO) {
    assert.ok(EXPORTADAS.includes(t), `${t} falta en el export`);
    assert.ok(BORRADAS.includes(t), `${t} falta en el borrado`);
  }
});

test('no hay tablas repetidas en ninguna lista', () => {
  assert.equal(new Set(EXPORTADAS).size, EXPORTADAS.length, 'export con duplicados');
  assert.equal(new Set(BORRADAS).size, BORRADAS.length, 'borrado con duplicados');
});
