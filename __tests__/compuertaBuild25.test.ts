// __tests__/compuertaBuild25.test.ts
// ─────────────────────────────────────────────────────────
// Lo que encontró la revisión adversarial del diff del build 25, justo antes
// de subirlo. Casi todo son regresiones que entraron en los lotes 3, 4 y 5 de
// la auditoría profunda: código nuevo que pasaba los tests y el compilador
// porque el fallo solo existe EN EJECUCIÓN.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resumirMes, type SesionDelMes, type SerieDelMes } from '../lib/actividadMensualCalculo';

const leerCodigo = (...p: string[]) =>
  fs
    .readFileSync(path.join(process.cwd(), ...p), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const local = (a: number, m: number, d: number, h = 18) => new Date(a, m, d, h, 0, 0).toISOString();

// ── BLOQUEANTE: el onboarding se podía quedar en el paso 0 ──

test('dos toques en «atrás» no pueden sacar el onboarding de su rango de pasos', () => {
  // El paso no cambia hasta 220 ms despues del toque, asi que la guarda leia
  // un `step` que aun no se habia movido: dos toques encolaban DOS restas y
  // dejaban step en 0, donde no renderiza ningun bloque. Pantalla negra sin
  // salida y formulario perdido.
  const src = leerCodigo('app', '(auth)', 'onboarding.tsx');
  assert.match(src, /const animando = useRef\(false\)/);
  // Las dos direcciones respetan el cerrojo.
  assert.match(src, /function nextStep\(\) \{\s*if \(animando\.current\) return;/);
  assert.match(src, /function prevStep\(\) \{\s*if \(animando\.current\) return;/);
  // Y el clamp dentro del updater funcional, que es lo que de verdad acota.
  assert.match(src, /setStep\(\(s\) => Math\.min\(4, s \+ 1\)\)/);
  assert.match(src, /setStep\(\(s\) => \(s <= 1 \? s : s - 1\)\)/);
  assert.ok(!/setStep\(\(s\) => s - 1\)/.test(src), 'queda una resta sin clamp');
  assert.ok(!/setStep\(\(s\) => s \+ 1\)/.test(src), 'queda una suma sin clamp');
  // El cerrojo se suelta siempre, o el onboarding se queda congelado.
  assert.equal((src.match(/animando\.current = false/g) ?? []).length, 2);
});

// ── ALTO: respuestas fuera de orden en "Tu mes" ──

test('la carga del mes descarta las respuestas que llegan tarde', () => {
  const src = leerCodigo('app', 'actividad.tsx');
  assert.match(src, /const peticion = useRef\(0\)/);
  assert.match(src, /const mia = \+\+peticion\.current/);
  // Los tres caminos: exito, fallo y el apagado del spinner.
  assert.equal((src.match(/mia !== peticion\.current\) return/g) ?? []).length, 2,
    'el exito y el fallo tienen que comprobarse por separado');
  assert.match(src, /if \(mia === peticion\.current\) setLoading\(false\)/);
  // Y el guardia va ANTES de escribir los datos.
  const iGuardia = src.indexOf('mia !== peticion.current');
  assert.ok(iGuardia > 0 && iGuardia < src.indexOf('setDatos(d)'));
});

// ── ALTO: la compuerta del plan acusaba a gente sana ──

test('«tu plan necesita un ajuste» no se pinta mientras el tamizaje carga', () => {
  // La revalidacion corre con el veto estricto puesto mientras injuriesStatus
  // es 'loading'. Un dia de impacto o cardio chocaba entero, la lista quedaba
  // vacia, y se acusaba de un cambio de salud que nunca hubo.
  const src = leerCodigo('app', 'workout-session.tsx');
  assert.match(src, /if \(injuriesStatus === 'ok' && revalidado\.vacio && planExercisesCrudos\.length > 0\)/);
  assert.ok(
    !/if \(revalidado\.vacio && planExercisesCrudos\.length > 0\)/.test(src),
    'la compuerta sigue evaluandose sin saber la salud',
  );
});

// ── ALTO: dos arranques a la vez ──

test('solo el arranque vigente escribe estado o navega', () => {
  const src = leerCodigo('app', 'index.tsx');
  assert.match(src, /const mio = \+\+intentoRef\.current/);
  assert.match(src, /const vigente = \(\) => intentoRef\.current === mio/);
  // Ninguna salida escribe sin comprobar.
  assert.ok(!/^\s*setConnectionError\(true\);/m.test(src), 'queda un setConnectionError sin guardia');
  for (const m of src.matchAll(/router\.replace\('\/\(auth\)\/onboarding'/g)) {
    assert.match(src.slice(Math.max(0, m.index! - 60), m.index!), /if \(vigente\(\)\) /);
  }
  // Un arranque lento pero bueno retira su propio error en vez de navegar por debajo.
  assert.match(src, /if \(!vigente\(\)\) return;\s*setConnectionError\(false\);\s*setOnboardingComplete\(true\)/);
  // Y una cadena vieja no puede declarar terminado el arranque de la nueva.
  assert.match(src, /if \(vigente\(\)\) terminadoRef\.current = true/);
});

// ── MEDIO: el permiso de camara se cerraba a la primera ──

test('negar la camara una vez no mata el reintento para siempre', () => {
  // Android SI vuelve a preguntar tras un "no" simple. Latir a la primera
  // dejaba a quien se equivoco con un boton que solo abria los ajustes.
  const src = leerCodigo('Components', 'PoseCamera.tsx');
  assert.match(src, /const intentos = useRef\(0\)/);
  assert.match(src, /intentos\.current \+= 1;\s*const ok = await requestPermission\(\);\s*if \(!ok && intentos\.current >= 2\) setDenegado\(true\)/);
  assert.ok(!/if \(!ok\) setDenegado\(true\)/.test(src), 'sigue latiendo a la primera negativa');
});

// ── MEDIO: cerrar sesion decia una mentira, y podia quedarse colgado ──

test('el aviso de fallo al cerrar sesion no promete lo que no puede', () => {
  const perfil = leerCodigo('app', '(tabs)', 'profile.tsx');
  assert.ok(!/no se ha tocado nada/.test(perfil), 'para entonces ya se cancelaron los avisos');
  assert.match(perfil, /tus datos están intactos/);
  assert.match(perfil, /recordatorios diarios quedaron en pausa/);
});

test('olvidar el token push no puede colgar el boton de cerrar sesion', () => {
  const perfil = leerCodigo('app', '(tabs)', 'profile.tsx');
  assert.match(perfil, /await Promise\.race\(\[\s*olvidarPushToken\(\),\s*new Promise\(\(r\) => setTimeout\(r, 5000\)\),\s*\]\)/);
});

// ── MEDIO: los vasos de agua se pisaban entre si ──

test('el area tactil de un vaso no invade la del siguiente', () => {
  // ~30 dp de vaso con huecos de ~6: los 10 dp laterales entraban en el vecino,
  // que se dibuja encima, asi que el borde derecho llenaba el vaso siguiente.
  const src = leerCodigo('app', '(tabs)', 'index.tsx');
  const i = src.indexOf('onPress={() => tapCup(i)}');
  assert.ok(i > 0);
  const bloque = src.slice(i, i + 260);
  assert.match(bloque, /hitSlop=\{\{ top: 10, bottom: 10, left: 2, right: 2 \}\}/);
  assert.ok(!/hitSlop=\{A11y\.hitSlop\}/.test(bloque), 'sigue con el hitSlop simetrico');
});

// ── MEDIO: los numeros del mes en curso ──

test('«por semana» del mes en curso divide entre los dias que van, no entre el mes entero', () => {
  const sesiones: SesionDelMes[] = [1, 2, 3].map((d) => ({
    id: `s${d}`, completed_at: local(2026, 8, d), duration_min: 45, exercises_completed: 5, day_index: 0,
  }));
  // Sin decir cuantos dias van: mes entero (30 dias => 4.29 semanas) => 0.7
  const mesEntero = resumirMes(sesiones, [], 2026, 8);
  assert.equal(mesEntero.porSemana, 0.7);
  // Diciendo que estamos a dia 3: tres entrenos en tres dias => 7 por semana.
  const enCurso = resumirMes(sesiones, [], 2026, 8, 3);
  assert.equal(enCurso.porSemana, 7);
  // Y no se puede pasar del mes ni bajar de un dia.
  assert.equal(resumirMes(sesiones, [], 2026, 8, 999).porSemana, 0.7);
  assert.ok(Number.isFinite(resumirMes(sesiones, [], 2026, 8, 0).porSemana));
});

test('un entreno abandonado marca el dia: las series ya contaban en los totales', () => {
  // Empezar, registrar tres series y no terminar: las series sumaban en los
  // KPIs y en la lista de ejercicios, pero el dia salia en blanco en el
  // calendario y no se podia tocar. La pantalla se contradecia sola.
  const series: SerieDelMes[] = [
    { exercise_name: 'Sentadilla', weight_kg: 60, reps: 8, logged_at: local(2026, 8, 9), session_id: 'abandonada' },
  ];
  const r = resumirMes([], series, 2026, 8);
  assert.equal(r.series, 1);
  assert.deepEqual(r.diasEntrenados, [9], 'el dia con series tiene que aparecer en el calendario');
  assert.equal(r.porDia[9].entrenos, 0);
  assert.deepEqual(r.porDia[9].ejercicios, ['Sentadilla']);
});

test('la pantalla marca el dia por sesion O por series, y lo dice sin mentir', () => {
  const src = leerCodigo('app', 'actividad.tsx');
  assert.match(src, /const entreno = !!dd && \(dd\.entrenos > 0 \|\| dd\.ejercicios\.length > 0\)/);
  assert.match(src, /sesión sin terminar/);
  assert.ok(!/\(resumen\.porDia\[d\]\?\.entrenos \?\? 0\) > 0/.test(src));
});

// ── MEDIO: la racha, tras mover el dia de UTC a Bogota ──

test('el cambio a hora local recalcula las fechas de racha ya guardadas', () => {
  // Un entreno de las 8 pm estaba anotado como el dia SIGUIENTE. Sin corregir,
  // el primer entreno despues de actualizar daba gap 0 y la racha no avanzaba.
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'setup.sql'), 'utf8')
    .replace(/^\s*--.*$/gm, '');
  const i = sql.indexOf('update public.user_stats s\nset last_workout_date = fuente.dia');
  assert.ok(i > 0, 'no hay correccion de last_workout_date');
  // Va DESPUES de crear la funcion que usa, o el archivo aborta entero.
  assert.ok(sql.indexOf('function public._dia_local') < i, '_dia_local se usa antes de existir');
  const bloque = sql.slice(i, i + 500);
  assert.match(bloque, /max\(public\._dia_local\(w\.completed_at\)\)/);
  assert.match(bloque, /w\.xp_credited_at is not null/, 'solo cuentan las sesiones ya acreditadas');
  assert.match(bloque, /is distinct from fuente\.dia/, 'tiene que ser idempotente');
});
