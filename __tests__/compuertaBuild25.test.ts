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
  // Ninguna salida escribe sin comprobar. Por SEMÁNTICA, no por formato: la
  // versión anterior de este test solo prohibía que la llamada empezara una
  // línea, así que una salida nueva escrita en una sola línea la burlaba.
  const errores = [...src.matchAll(/setConnectionError\(true\)/g)];
  assert.ok(errores.length >= 3, 'faltan salidas de error que vigilar');
  for (const m of errores) {
    assert.match(
      src.slice(Math.max(0, m.index! - 90), m.index!),
      /vigente\(\)/,
      `un setConnectionError(true) sin vigente() cerca: ...${src.slice(Math.max(0, m.index! - 70), m.index! + 25)}`,
    );
  }
  for (const m of src.matchAll(/router\.replace\('\/\(auth\)\/onboarding'/g)) {
    assert.match(src.slice(Math.max(0, m.index! - 60), m.index!), /if \(vigente\(\)\) /);
  }
  // ASIMETRÍA: el ÉXITO entra siempre. Con el guardia también en el camino
  // bueno, un arranque lento que terminara tras tocar Reintentar se
  // descartaba con el perfil ya escrito y dejaba la pantalla clavada en el
  // error, sin forma de entrar salvo matar la app.
  assert.match(src, /navegadoRef\.current = true;\s*setConnectionError\(false\);\s*setOnboardingComplete\(true\)/);
  assert.ok(
    !/if \(!vigente\(\)\) return;\s*setConnectionError\(false\)/.test(src),
    'el camino de éxito volvió a exigir ser el intento vigente',
  );
  // Y una vez dentro, ningún vigilante rezagado repinta el error.
  assert.match(src, /if \(!navegadoRef\.current && vigente\(\) && !terminadoRef\.current\) setConnectionError\(true\)/);
  // Una cadena vieja tampoco declara terminado el arranque de la nueva.
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
  // Menos de una semana NO da un ritmo semanal: extrapolar "3 entrenos en 3
  // dias => 7 por semana" es tan falso como el 0.7 de antes, en el otro
  // extremo. 0 significa "todavia no hay ventana" y la pantalla se calla.
  assert.equal(resumirMes(sesiones, [], 2026, 8, 3).porSemana, 0);
  assert.equal(resumirMes(sesiones, [], 2026, 8, 1).porSemana, 0);
  assert.equal(resumirMes(sesiones, [], 2026, 8, 6).porSemana, 0);
  // A partir de una semana si, y sobre los dias que van.
  assert.equal(resumirMes(sesiones, [], 2026, 8, 7).porSemana, 3);
  // Y no se puede pasar del mes ni bajar de un dia.
  assert.equal(resumirMes(sesiones, [], 2026, 8, 999).porSemana, 0.7);
  assert.ok(Number.isFinite(resumirMes(sesiones, [], 2026, 8, 0).porSemana));
});

test('la pantalla se calla el ritmo semanal cuando no hay ventana', () => {
  const src = leerCodigo('app', 'actividad.tsx');
  assert.match(src, /\{resumen\.porSemana > 0 \? `≈ \$\{resumen\.porSemana\} por semana · ` : ''\}/);
  assert.ok(!/resumen\.entrenos > 0 \? `≈/.test(src), 'vuelve a enseñar el ritmo sin ventana suficiente');
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
  assert.ok(!/\(resumen\.porDia\[d\]\?\.entrenos \?\? 0\) > 0/.test(src));
  // El coach en vivo guarda series SIN sesion (live-coach.tsx pasa
  // session_id null), asi que estos dos estados se dan de verdad y las tres
  // superficies —celda, texto visible y lector de pantalla— tienen que decir
  // lo mismo. El aviso de mes vacio se contradecia con los dias ya pintados.
  assert.equal((src.match(/sesión sin terminar/g) ?? []).length, 2,
    'el texto visible y la etiqueta de accesibilidad tienen que coincidir');
  assert.match(src, /\{resumen\.diasEntrenados\.length === 0 && \(/);
  assert.ok(!/\{resumen\.entrenos === 0 && \(/.test(src),
    'el aviso de mes vacio vuelve a mirar solo las sesiones terminadas');
});

test('el coach en vivo guarda series sin sesion: por eso el dia se marca por series', () => {
  // Este es el hecho del que dependen los dos asserts de arriba. Si algun dia
  // el coach en vivo pasa a crear sesion, esta prueba avisa de que la razon
  // del arreglo desaparecio (y de que hay que revisarlo, no de que este mal).
  const vivo = leerCodigo('app', 'live-coach.tsx');
  assert.match(vivo, /saveSetLogs\(profile\.user_id, null,/);
  const setLogs = leerCodigo('lib', 'setLogs.ts');
  assert.match(setLogs, /sessionId: string \| null/);
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
  // LO MÁS IMPORTANTE de toda la sentencia. Es un UPDATE sin filtro contra
  // user_stats de producción: sin la correlación del join, le pondría a TODO
  // el mundo la fecha de un usuario cualquiera.
  assert.match(bloque, /where fuente\.user_id = s\.user_id/, 'el UPDATE pisaría a todos los usuarios');
  assert.match(bloque, /group by w\.user_id/, 'la subconsulta tiene que agrupar por persona');
});
