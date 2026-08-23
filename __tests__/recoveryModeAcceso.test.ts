// __tests__/recoveryModeAcceso.test.ts
// ─────────────────────────────────────────────────────────
// __tests__/recoveryMode.test.ts prueba que las banderas se CALCULEN bien.
// Ninguno probaba que sirvieran para algo — y no servían.
//
// Eran condicional de renderizado en tres pantallas, mientras:
//   • las rutas se abrían por enlace directo (app.json declara el scheme
//     "gymup", así que gymup://body-scan entra sin tocar ningún botón);
//   • la MISMA pantalla que mostraba el aviso seguía enseñando "Escanear
//     cuerpo" 330 líneas más abajo;
//   • el expediente que va al coach de IA llevaba peso, meta, proyección,
//     macros del día y el "~X% de grasa" del último análisis;
//   • `sinRecompensasCorporales` estaba declarada y NO LA LEÍA NADIE, así que
//     la app seguía dando XP por cada comida y felicitando por "cubrir las
//     cuatro metas del día";
//   • y el store arrancaba en NEUTRO sin que nadie hidratara la salud, así que
//     el modo podía ni estar encendido cuando se pintaban las calorías.
//
// Esto es una función sobre trastornos de la conducta alimentaria. Esconder un
// botón no es protegerla.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  modoRecuperacion,
  bloqueada,
  filtrarExpediente,
  RUTAS_PROTEGIDAS,
  CAMPOS_CORPORALES_DEL_COACH,
} from '../lib/recoveryMode';
// Desde missionsMath, el módulo PURO: lib/missions.ts importa supabase, que
// arrastra react-native y no se puede cargar en el runner de Node.
import { misionesDisponibles, WEEKLY_MISSIONS } from '../lib/missionsMath';

const leer = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');

/**
 * El archivo SIN comentarios.
 *
 * Hace falta porque los comentarios de este proyecto CITAN el código
 * defectuoso para explicar por qué se cambió, y un test que busque texto a
 * secas los confunde con código vivo. Volvió a pasar escribiendo este mismo
 * archivo: dos tests dieron un falso fallo porque encontraron "router.replace"
 * y "Escanear cuerpo" dentro de comentarios que explicaban por qué se
 * quitaron.
 */
const leerCodigo = (...p: string[]) =>
  leer(...p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // comentarios JSX
    .replace(/\/\*[\s\S]*?\*\//g, '') // bloque
    .replace(/^\s*\/\/.*$/gm, ''); // línea

const ACTIVO = modoRecuperacion({
  conditions: ['trastorno_alimentario'],
  injuries: [],
} as any);
const NEUTRO = modoRecuperacion(null);

const AREAS = ['cuerpo', 'calorias', 'peso'] as const;

// ── Las áreas ──

test('con el modo activo, las tres áreas quedan bloqueadas', () => {
  for (const area of AREAS) assert.equal(bloqueada(ACTIVO, area), true, area);
});

test('sin el modo no se bloquea nada', () => {
  for (const area of AREAS) assert.equal(bloqueada(NEUTRO, area), false, area);
});

// ── Las rutas se defienden solas ──

test('cada ruta sensible declara qué área protege', () => {
  assert.deepEqual(Object.keys(RUTAS_PROTEGIDAS).sort(), [
    '/body-scan',
    '/food-manual',
    '/food-scan',
    '/fridge-scan',
  ]);
});

test('las cuatro rutas usan el guardia, y por su área correcta', () => {
  // El guardia va DENTRO de la ruta, no en quien navega hasta ella. Esconder el
  // botón de origen dejaba abierto el enlace directo y cualquier router.push
  // que se añada mañana.
  for (const [ruta, area] of Object.entries(RUTAS_PROTEGIDAS)) {
    const codigo = leer('app', `${ruta.slice(1)}.tsx`);
    assert.match(codigo, /<GuardiaRecuperacion/, `${ruta} no está protegida`);
    assert.ok(
      codigo.includes(`area="${area}"`),
      `${ruta} debería proteger el área "${area}"`,
    );
  }
});

test('el guardia envuelve; no es un if dentro del componente', () => {
  const codigo = leer('app', 'body-scan.tsx');
  const iContenido = codigo.indexOf('function BodyScanScreenContenido');
  const iGuardia = codigo.indexOf('<GuardiaRecuperacion');
  assert.ok(iContenido > 0, 'el contenido debería estar en su propia función');
  assert.ok(iGuardia > iContenido, 'la protección tiene que envolver desde fuera');
});

test('el guardia explica, no expulsa en silencio', () => {
  // Un router.replace se lee como un fallo de la app: la persona toca algo y
  // desaparece, sin saber por qué ni que sus datos siguen ahí.
  const guardia = leerCodigo('Components', 'GuardiaRecuperacion.tsx');
  assert.ok(!/router\.replace/.test(guardia), 'debe explicar, no expulsar');
  assert.match(guardia, /AVISO_RECUPERACION/);
});

// ── Lo que sale del teléfono ──

const expediente = () =>
  ({
    name: 'Ana',
    age: 30,
    currentWeight: 62.5,
    targetWeight: 55,
    projection: { hasGoal: true, remainingKg: 7.5 },
    macros: { calories: [1200, 2000], protein: [40, 120], carbs: [100, 200], fat: [30, 60] },
    lastBodyScan: { score: 72, fatPct: 21, focus: ['abdomen'] },
    todayMeals: [{ name: 'Ensalada', calories: 320 }],
    streak: 5,
    healthBlock: 'directivas',
  }) as any;

test('el expediente sale SIN peso, meta, proyección, macros ni % de grasa', () => {
  // Lo único que había era un healthBlock que le PEDÍA al modelo no hablar de
  // peso, mientras le entregaba el peso en el mismo prompt. Una instrucción no
  // es un control: el número ya salió del dispositivo.
  const filtrado = filtrarExpediente(expediente(), ACTIVO) as Record<string, unknown>;
  for (const campo of CAMPOS_CORPORALES_DEL_COACH) {
    assert.ok(!(campo in filtrado), `"${campo}" sigue saliendo del dispositivo`);
  }
});

test('los campos se QUITAN, no se ponen en null', () => {
  // Un campo presente valiendo null sigue diciéndole al modelo que existe una
  // báscula de la que se puede hablar.
  const filtrado = filtrarExpediente(expediente(), ACTIVO) as Record<string, unknown>;
  assert.equal(Object.prototype.hasOwnProperty.call(filtrado, 'currentWeight'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filtrado, 'macros'), false);
});

test('lo que NO es corporal sigue llegando al coach', () => {
  // Vaciar el expediente entero dejaría a la persona sin coach, que es
  // exactamente lo contrario de lo que hace falta.
  const filtrado = filtrarExpediente(expediente(), ACTIVO) as Record<string, unknown>;
  assert.equal(filtrado.name, 'Ana');
  assert.equal(filtrado.streak, 5);
  assert.equal(filtrado.healthBlock, 'directivas');
});

test('sin el modo, el expediente va entero', () => {
  const original = expediente();
  assert.deepEqual(filtrarExpediente(original, NEUTRO), original);
});

test('el filtro vive donde se arma el expediente, no en cada consumidor', () => {
  const ctx = leer('lib', 'coachContext.ts');
  assert.match(ctx, /filtrarExpediente\(expediente, modo\)/);
  // Y el prompt tiene que aguantar que los campos falten, en vez de escribir
  // "Peso actual: undefined kg".
  assert.match(ctx, /s\.currentWeight != null/);
});

test('los campos filtrados existen de verdad en el snapshot', () => {
  // Escribí la primera lista de memoria —'weight', 'nutrition', 'bodyScan'— y
  // NINGUNO existía: el snapshot los llama currentWeight, macros y lastBodyScan.
  // El filtro habría compilado y no habría borrado nada. Ahora la lista está
  // tipada como keyof CoachSnapshot, pero esto lo comprueba también contra el
  // archivo, por si alguien afloja el tipo.
  const ctx = leer('lib', 'coachContext.ts');
  for (const campo of CAMPOS_CORPORALES_DEL_COACH) {
    assert.ok(
      new RegExp(`^\\s{2}${campo}\\??:`, 'm').test(ctx),
      `"${campo}" no es un campo de CoachSnapshot: el filtro no borraría nada`,
    );
  }
});

// ── Las recompensas ──

test('sin recompensas corporales desaparece la misión de proteína', () => {
  assert.ok(!misionesDisponibles(true).some((m) => m.type === 'protein_days'));
});

test('pero quedan las de entrenar y descansar', () => {
  // Quitarle todas las metas a alguien es otra forma de decirle que aquí ya no
  // hay nada para él.
  const conModo = misionesDisponibles(true);
  assert.ok(conModo.length > 0);
  assert.ok(conModo.some((m) => m.type === 'planned_workouts'));
  assert.ok(conModo.some((m) => m.type === 'rest_day'));
});

test('sin el modo están todas', () => {
  assert.equal(misionesDisponibles(false).length, WEEKLY_MISSIONS.length);
});

test('la comida se sigue guardando; lo que se retira es el premio', () => {
  // Dejar de registrar sería quitarle a la persona el control de sus propios
  // datos. El corte tiene que ir DESPUÉS del insert.
  const logMeal = leer('lib', 'logMeal.ts');
  const iInsert = logMeal.indexOf("from('food_logs').insert");
  const iCorte = logMeal.indexOf('const sinPremios');
  assert.ok(iInsert > 0, 'no encontré el insert de la comida');
  assert.ok(iCorte > iInsert, 'el corte de recompensas va DESPUÉS de guardar');
  assert.match(logMeal, /if \(!sinPremios\)/);
});

test('sinRecompensasCorporales ya la lee alguien', () => {
  // Estuvo declarada y sin usar desde el principio. Por eso seguían vivos el XP
  // por comida, el bonus de "macro perfecto" y la misión de proteína.
  const cableada = ['lib/logMeal.ts', 'lib/missions.ts'].filter((f) =>
    /sinRecompensasCorporales/.test(leer(...f.split('/'))),
  );
  assert.equal(cableada.length, 2, 'la bandera tiene que estar cableada');
});

// ── El arranque ──

test('el modo se hidrata al abrir la app', () => {
  // El store nacía en NEUTRO y nadie cargaba la salud en el arranque: la
  // hidratación dependía de que alguna pantalla llamara a loadHealthSafe por
  // otro motivo, y en la portada eso no estaba garantizado. El modo podía no
  // estar ni encendido cuando ya se habían pintado las calorías.
  assert.match(leer('app', 'index.tsx'), /loadHealthSafe\(session\.user\.id\)/);
});

// ── Los cortes de acción ──

test('no se puede guardar peso ni fijar meta con el modo activo', () => {
  const progress = leer('app', '(tabs)', 'progress.tsx');
  for (const fn of ['saveWeight', 'saveGoal']) {
    const i = progress.indexOf(`async function ${fn}`);
    assert.ok(i > 0, `no encontré ${fn}`);
    assert.match(
      progress.slice(i, i + 500),
      /recuperacion\.ocultarPeso/,
      `${fn} tiene que cortar la acción, no solo esconder el botón`,
    );
  }
});

test('el botón de anotar peso ya no vive fuera de la rama del modo', () => {
  // Estaba en la cabecera, 120 líneas antes del ternario de ocultarPeso: la
  // pantalla escondía la gráfica de la báscula y dejaba el botón justo arriba.
  const progress = leerCodigo('app', '(tabs)', 'progress.tsx');
  const i = progress.indexOf('+ Peso');
  assert.ok(i > 0);
  assert.match(progress.slice(Math.max(0, i - 600), i), /!recuperacion\.ocultarPeso/);
});

test('el perfil ya conoce el modo', () => {
  // No lo importaba en absoluto: mostraba el peso, y los cuatro macros en
  // números grandes, y dejaba editar el peso —que además recalcula calorías.
  const perfil = leer('app', '(tabs)', 'profile.tsx');
  assert.match(perfil, /useRecuperacion\(\)/);
  assert.match(perfil, /recuperacion\.ocultarPeso/);
  assert.match(perfil, /recuperacion\.ocultarCalorias/);
});

test('la portada no ofrece escanear el cuerpo con el modo activo', () => {
  // La misma pantalla que pinta el aviso lo seguía ofreciendo 330 líneas abajo.
  const inicio = leerCodigo('app', '(tabs)', 'index.tsx');
  const i = inicio.indexOf('Escanear cuerpo');
  assert.ok(i > 0);
  assert.match(inicio.slice(Math.max(0, i - 500), i), /!recuperacion\.ocultarCuerpo/);
});

test('el coach de reglas no recibe cifras de proteína con el modo activo', () => {
  // Emite "te faltan N g para tu meta de hoy", que es exactamente la frase que
  // la portada acaba de decidir no mostrar.
  const inicio = leer('app', '(tabs)', 'index.tsx');
  assert.match(inicio, /proteinaHoyG: recuperacion\.ocultarCalorias \? null/);
});
