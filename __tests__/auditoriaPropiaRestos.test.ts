// __tests__/auditoriaPropiaRestos.test.ts
// ─────────────────────────────────────────────────────────
// El resto de lo que encontró mi auditoría. Cosas más pequeñas que los
// bloqueadores, pero de la misma familia: algo que se calcula y no llega, una
// bandera sin lectores, una lista que se pensó y se escribió con la clave
// equivocada.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leer = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');
const leerCodigo = (...p: string[]) =>
  leer(...p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// ── Ninguna bandera sin lectores ──

test('todos los interruptores tienen quien los consulte', () => {
  // coach_ia estaba declarado, sembrado en la tabla y con test de su valor por
  // defecto — y no lo leía NADIE. Una bandera que no consulta nadie no apaga
  // nada: es la misma clase de fallo que sinRecompensasCorporales.
  const flags = leerCodigo('lib', 'featureFlags.ts');
  // Las claves salen del tipo, no de una lista escrita a mano aquí: si mañana
  // se añade una cuarta, este test la exige igual sin que nadie lo toque.
  const tipo = flags.match(/export type ClaveFlag =([^;]+);/);
  assert.ok(tipo, 'no encontré el tipo ClaveFlag');
  const claves = [...tipo![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(claves.length >= 3, `solo encontré ${claves.length} claves`);

  const proxy = leerCodigo('supabase', 'functions', 'ai-proxy', 'index.ts');
  const guardias = ['app/body-scan.tsx', 'app/(tabs)/coach.tsx']
    .map((f) => leerCodigo(...f.split('/')))
    .join('\n');

  for (const clave of new Set(claves)) {
    assert.ok(
      proxy.includes(`'${clave}'`) || guardias.includes(`clave="${clave}"`),
      `el interruptor "${clave}" no lo consulta nadie: o se cablea o se quita`,
    );
  }
});

// ── El tamizaje diario de bienestar no sale hacia PostHog ──

test('energía, sueño, estrés y dolor no viajan a PostHog', () => {
  // workout_readiness_submitted los emite todos y la lista no cubría ninguno.
  // Lo delator: la lista SÍ tenía 'pain'. Se pensó en el dolor y se escribió la
  // clave equivocada — en el evento se llama 'pain_new'.
  const posthog = leer('lib', 'posthog.ts');
  for (const prop of ['energy', 'sleep_quality', 'stress', 'soreness', 'pain_new']) {
    assert.ok(posthog.includes(`'${prop}'`), `"${prop}" no está en la lista de propiedades sensibles`);
  }
});

// ── El fichero exportado no sobrevive al borrado ──

test('el JSON de "exportar mis datos" se borra con la cuenta', () => {
  // Es un JSON EN CLARO con el perfil, el tamizaje PAR-Q+ entero, el peso, las
  // comidas y los análisis corporales. Se escribe en la caché para poder
  // compartirlo y nunca se borraba.
  const borrado = leer('lib', 'borradoLocal.ts');
  assert.match(borrado, /gymup-mis-datos\.json/);
  assert.match(borrado, /deleteAsync/);

  // Y que el nombre siga siendo el mismo que escribe el perfil.
  const perfil = leer('app', '(tabs)', 'profile.tsx');
  assert.ok(
    perfil.includes("'gymup-mis-datos.json'") || perfil.includes('gymup-mis-datos.json'),
    'el nombre del fichero cambió y el borrado se quedó apuntando al viejo',
  );
});

// ── El paywall no afirma un descuento sin precio ──

test('sin precios reales no se afirma ningún ahorro', () => {
  // Devolvía el 33% de respaldo, así que la tarjeta anual podía decir
  // "— /año · ahorra 33%": un descuento afirmado sobre una cifra que no existe.
  const paywall = leerCodigo('app', 'paywall.tsx');
  assert.match(paywall, /if \(!mensual \|\| !anual \|\| mensual <= 0 \|\| anual <= 0\) return null;/);
  assert.ok(
    !/return PLANS\.yearly\.save/.test(paywall),
    'el respaldo del 33% no puede afirmarse sin precios',
  );
});

// ── El peso al reincorporarse ──

test('tras una ausencia larga el peso se precarga reducido', () => {
  // El factor se calculaba, se enseñaba en la portada y se le contaba al coach —
  // y la sesión seguía proponiendo la carga de antes de parar. El comentario de
  // planCalendario dice que eso es cómo se lesiona la gente al volver.
  const sesion = leerCodigo('app', 'workout-session.tsx');
  assert.match(sesion, /const factorReincorporacion = estadoHoy\?\.reincorporacion\?\.factorCarga \?\? 1/);
  assert.match(sesion, /pesoPrevio \* factorReincorporacion/);
});

test('sin ausencia el peso no se toca', () => {
  // Reducir siempre sería el error contrario: quitarle carga a quien viene
  // entrenando.
  const sesion = leerCodigo('app', 'workout-session.tsx');
  assert.match(sesion, /factorReincorporacion < 1/);
});

test('el peso reducido se redondea a un salto de disco real', () => {
  // 47,3 kg no existe en ningún gimnasio.
  assert.match(leerCodigo('app', 'workout-session.tsx'), /\/ 2\.5\) \* 2\.5/);
});
