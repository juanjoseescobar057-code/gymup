// __tests__/auditoriaPropia.test.ts
// ─────────────────────────────────────────────────────────
// Lo que encontró mi propia auditoría, después de tres externas.
//
// Catorce agentes con ocho lentes distintas sobre el HEAD. Los hallazgos graves
// eran casi todos MÍOS, introducidos al arreglar los de las auditorías
// anteriores — que es exactamente el riesgo de arreglar mucho y deprisa.
//
// El patrón, otra vez el mismo:
//   • un flag que se buscaba por la clave equivocada, así que no se aplicaba a
//     quien estaba en la prueba gratis;
//   • un grado de finalización que se calculaba, se guardaba, y no llegaba a
//     ningún sitio — con un comentario afirmando que sí;
//   • una idempotencia que no comprobaba de quién era la reserva;
//   • un veto de intensidad que solo miraba el NOMBRE del ejercicio;
//   • y una bandera cableada en dos archivos, con un test que solo miraba esos
//     dos, mientras la pantalla que de verdad la pinta no la miraba.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validarPlan, type PlanSemanal } from '../lib/planValidator';
// Del módulo PURO: lib/streaks.ts importa supabase, que arrastra react-native y
// no se puede cargar en el runner de Node.
import { insigniasDisponibles, BADGES } from '../lib/badgesCatalogo';
import { MODO_MIENTRAS_NO_SE_SEPA, CAMPOS_CORPORALES_DEL_COACH } from '../lib/recoveryMode';

const leer = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');
const setup = leer('supabase', 'setup.sql');
const proxy = leer('supabase', 'functions', 'ai-proxy', 'index.ts');

// ── El kill switch, durante la prueba gratis ──

test('el interruptor se busca por la feature, no por la clave del contador', () => {
  // Durante la prueba, los escaneos de imagen comparten un contador
  // ('trial_scans'), así que claveContador NO es la feature: el lookup no
  // encontraba nada y el análisis corporal seguía funcionando con el
  // interruptor apagado. Un kill switch con un agujero de siete días.
  assert.match(proxy, /const claveFlag = FLAG_DE_FEATURE\[feature\]/);
  assert.ok(
    !/FLAG_DE_FEATURE\[claveContador\]/.test(proxy),
    'buscar por claveContador deja fuera a quien está en la prueba',
  );
});

// ── El grado de finalización llega hasta el XP ──

test('el grado de la sesión llega a la acreditación', () => {
  // Se calculaba, se guardaba y se quedaba ahí: una sesión de una serie seguía
  // cobrando el XP entero y sumando a la racha. Solo se había frenado el avance
  // del día del plan, y el comentario afirmaba lo contrario.
  const i = setup.indexOf('function public.apply_workout_stats');
  const cuerpo = setup.slice(i, setup.indexOf('$$;', i));
  assert.match(cuerpo, /into v_date, v_grado/, 'el grado tiene que salir de la misma fila que se reclama');
  assert.match(cuerpo, /when 'parcial' then floor\(v_xp \* 0\.5\)/);
  assert.match(cuerpo, /when 'minima'  then floor\(v_xp \* 0\.25\)/);
});

test('una sesión mínima no suma a la racha ni al total', () => {
  const i = setup.indexOf('function public.apply_workout_stats');
  const cuerpo = setup.slice(i, setup.indexOf('$$;', i));
  assert.match(cuerpo, /if v_grado = 'minima' then\s*\n\s*v_new_streak := v_streak;/);
  assert.match(cuerpo, /case when v_grado = 'minima' then 0 else 1 end/);
});

test('sin grado se paga entero, como antes', () => {
  // Un build antiguo no manda las series planeadas. Inventarle un grado sería
  // el mismo error en la otra dirección.
  const i = setup.indexOf('function public.apply_workout_stats');
  const cuerpo = setup.slice(i, setup.indexOf('$$;', i));
  assert.match(cuerpo, /else v_xp\s*\n\s*end;/);
});

// ── La evidencia del XP no la escribe el cliente ──

test('la marca de acreditación no la puede tocar el cliente', () => {
  // xp_credited_at es lo que impide cobrar dos veces el XP de una sesión.
  // Con UPDATE de tabla completa se devolvía a null y se reclamaba otra vez.
  for (const [tabla, verbos] of [
    ['workout_sessions', ['insert', 'update']],
    ['food_logs', ['update']],
    ['body_scans', ['update']],
  ] as const) {
    const linea = setup
      .split('\n')
      .find((l) => l.includes(`on public.${tabla} from anon, authenticated`) && l.trimStart().startsWith('revoke'));
    assert.ok(linea, `${tabla} no revoca nada`);
    for (const v of verbos) {
      assert.ok(linea!.includes(v), `${tabla} debería revocar ${v}`);
    }
  }
});

test('borrar su propio historial sigue siendo un derecho', () => {
  // Cerrar de más también es un fallo: la pantalla de perfil ofrece borrar los
  // análisis corporales, y eso tiene que seguir funcionando.
  const linea = setup
    .split('\n')
    .find((l) => l.includes('on public.body_scans from anon, authenticated'));
  assert.ok(linea && !linea.includes('delete'), 'body_scans debe conservar DELETE');
});

// ── El coach falla cerrado ──

test('con la salud ilegible, el coach no recibe nada corporal', () => {
  // modoRecuperacion(null) devuelve NEUTRO —correcto para "no tiene tamizaje"—
  // y eso convertía "no pude leerlo" en "no tiene nada": el peso, la meta, los
  // macros y el % de grasa salían hacia OpenAI.
  assert.equal(MODO_MIENTRAS_NO_SE_SEPA.activo, true);
  assert.match(leer('lib', 'coachContext.ts'), /MODO_MIENTRAS_NO_SE_SEPA/);
});

test('el porqué escrito por la persona tampoco sale', () => {
  // Es texto libre, y ahí es donde suele estar el número que se acaba de borrar
  // de targetWeight: "quiero llegar a 55 kg".
  assert.ok(CAMPOS_CORPORALES_DEL_COACH.includes('goalWhy' as never));
});

// ── Las recompensas de comida ──

test('sin recompensas corporales desaparecen las insignias de comida y macros', () => {
  const conModo = insigniasDisponibles(true);
  assert.ok(!conModo.some((b) => b.requirement.type === 'meals'));
  assert.ok(!conModo.some((b) => b.requirement.type === 'macro_days'));
});

test('pero quedan las de entrenar y constancia', () => {
  const conModo = insigniasDisponibles(true);
  assert.ok(conModo.some((b) => b.requirement.type === 'streak'));
  assert.ok(conModo.some((b) => b.requirement.type === 'sessions'));
  assert.ok(conModo.length > 0);
});

test('sin el modo están todas', () => {
  assert.equal(insigniasDisponibles(false).length, BADGES.length);
});

test('la pantalla que las PINTA también las filtra', () => {
  // La bandera se cableó en el registro de comida y en las misiones, y el test
  // solo comprobaba esos dos archivos. La pantalla de progreso —la que de
  // verdad las enseña— seguía pintando "Días macro ✓" y las insignias de comida.
  const progress = leer('app', '(tabs)', 'progress.tsx');
  assert.match(progress, /insigniasDisponibles\(recuperacion\.sinRecompensasCorporales\)/);
  const i = progress.indexOf('Días macro ✓');
  assert.ok(i > 0);
  assert.match(
    progress.slice(Math.max(0, i - 400), i),
    /recuperacion\.sinRecompensasCorporales/,
    'el contador de días macro tiene que estar detrás del modo',
  );
});

// ── El veto de intensidad, sobre el campo y no sobre el nombre ──

const conIntensidad = (extra: Record<string, unknown>): PlanSemanal => ({
  overview: '',
  days: [{
    day: 1, day_name: 'L', type: 'workout', muscle_groups: ['Hombro'],
    estimated_duration_min: 40,
    exercises: [{
      name: 'Elevaciones laterales', sets: 3, reps: '10', rest_seconds: 60,
      notes: '', muscle_group: 'Hombro', ...extra,
    }],
  }],
});

test('con cardiopatía no se programa un dropset, aunque el ejercicio suene inocuo', () => {
  // El veto de 'intensidad_alta' solo se comparaba con el NOMBRE del ejercicio.
  // "Curl con mancuerna" no suena a intensidad alta, así que un
  // intensity_method: 'drop_set' pasaba entero.
  const r = validarPlan(conIntensidad({ intensity_method: 'drop_set' }), {
    injuries: [], conditions: ['cardiopatia'], equipment: 'gym', age: 30,
  });
  assert.equal(r.plan.days[0].exercises[0].intensity_method, 'none');
  assert.equal(r.correcciones[0].accion, 'ajustado');
});

test('un RIR al fallo también se corrige', () => {
  // target_rir 0 es "hasta el fallo", que es intensidad alta escrita en otro
  // campo. Normalizar solo intensity_method dejaba la mitad del problema.
  const r = validarPlan(conIntensidad({ target_rir: 0 }), {
    injuries: [], conditions: ['embarazo'], equipment: 'gym', age: 30,
  });
  assert.ok((r.plan.days[0].exercises[0].target_rir ?? 0) >= 2);
});

test('sin condición que lo vete, un dropset a los 40 pasa', () => {
  // El validador tiene que corregir lo que choca, no todo.
  const r = validarPlan(conIntensidad({ intensity_method: 'drop_set' }), {
    injuries: [], conditions: [], equipment: 'gym', age: 40,
  });
  assert.deepEqual(r.correcciones, []);
  assert.equal(r.plan.days[0].exercises[0].intensity_method, 'drop_set');
});
