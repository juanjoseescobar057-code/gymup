// __tests__/integridadDatos.test.ts
// El helper de RLS concede los CUATRO verbos sobre la tabla entera a cualquier
// usuario autenticado. Para casi todo eso esta bien: son sus datos. Para tres
// tablas no, y por motivos distintos.
//
// Ya paso con user_profiles, donde ese mismo patron dejaba autoconcederse
// Premium. La leccion no era "arregla user_profiles": era revisar cada tabla
// donde el dueno del dato NO deberia poder cambiarlo.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const setup = fs.readFileSync(path.join(process.cwd(), 'supabase', 'setup.sql'), 'utf8');

/** Los verbos que quedan concedidos a los roles del cliente sobre una tabla. */
function revocado(tabla: string, verbo: string): boolean {
  const lineas = setup
    .split('\n')
    .filter((l) => l.includes(`on public.${tabla} from anon, authenticated`));
  // Sin expresión regular construida con plantilla: el `\b` de un RegExp escrito
  // así se pierde con facilidad y el test pasa sin comprobar nada. Los verbos de
  // un revoke van separados por coma, así que basta con partir por comas.
  return lineas.some((l) => {
    const verbos = l.slice(l.indexOf('revoke') + 6, l.indexOf(' on '))
      .split(',')
      .map((v) => v.trim());
    return l.trimStart().startsWith('revoke') && verbos.includes(verbo);
  });
}

// ── XP y misiones: el usuario no se puede reiniciar la partida ──

test('user_stats no acepta insert, update ni delete del cliente', () => {
  // Escribir XP ya estaba cerrado. BORRAR no: la fila guarda claimed_missions,
  // asi que borrarla dejaba reclamar otra vez todas las misiones de la semana,
  // ademas de poner a cero racha, nivel e insignias.
  for (const verbo of ['insert', 'update', 'delete']) {
    assert.ok(revocado('user_stats', verbo), `user_stats deberia revocar ${verbo}`);
  }
});

test('los resultados solo los escribe el servidor', () => {
  // La unica via es la RPC, que recalcula del lado del servidor.
  assert.match(setup, /function public\.apply_workout_stats\(/);
  assert.match(setup, /function public\.claim_mission\(/);
});

// ── Los reportes de contenido son evidencia ──

test('un reporte de IA no se puede reescribir ni borrar', () => {
  // Google Play exige poder reportar contenido de IA. Una cola que el
  // reportante puede vaciar —o marcarse como 'reviewed'— no cumple nada.
  for (const verbo of ['update', 'delete']) {
    assert.ok(revocado('ai_content_reports', verbo), `ai_content_reports deberia revocar ${verbo}`);
  }
});

test('pero se sigue pudiendo reportar y ver lo reportado', () => {
  // Cerrar de mas seria quitarle a la persona la funcion entera.
  const reportes = fs.readFileSync(path.join(process.cwd(), 'lib', 'aiReports.ts'), 'utf8');
  assert.match(reportes, /from\('ai_content_reports'\)\s*\.insert/);
});

// ── Observabilidad: el observado no edita la observacion ──

test('el costo y los tokens de la telemetria no los puede reescribir el cliente', () => {
  assert.ok(revocado('ai_telemetry', 'update'));
  assert.ok(revocado('ai_telemetry', 'delete'));
});

test('pero el juez de calidad sigue pudiendo adjuntar su puntuacion', () => {
  // Corre DESPUES de la respuesta y escribe en la misma fila. Por eso el
  // permiso se estrecha por columnas en vez de quitarse: se puede escribir el
  // score, no el costo.
  assert.match(
    setup,
    /grant update \(score, hallucination, score_reason, signals\) on public\.ai_telemetry/,
  );
});

test('un evento de analitica no se reescribe ni se borra', () => {
  // Un evento ocurrio o no ocurrio. Cambiarlo despues no es corregir un dato.
  assert.ok(revocado('analytics_events', 'update'));
  assert.ok(revocado('analytics_events', 'delete'));
});

// ── Lo que NO hay que cerrar ──

test('el historial de analisis corporal se sigue pudiendo borrar', () => {
  // Es lo contrario de los anteriores: son SUS fotos y SU historial, y poder
  // borrarlas es un derecho, no un agujero.
  const perfil = fs.readFileSync(path.join(process.cwd(), 'app', '(tabs)', 'profile.tsx'), 'utf8');
  assert.match(perfil, /from\('body_scans'\)[\s\S]{0,60}\.delete\(\)/);
  assert.ok(!revocado('body_scans', 'delete'), 'borrar sus propios escaneos es un derecho');
});
