// __tests__/ningunaSalidaSeQuedaConElDinero.test.ts
// ─────────────────────────────────────────────────────────
// Toda salida posterior a la reserva devuelve la reserva.
//
// reservar_ai suma el estimado a ai_cost_usage e inserta una fila abierta en
// ai_reservas. Solo ajustar_ai la cierra, y NO hay barrido de reservas
// huérfanas: lo que salga sin cuadrarse se queda cobrado hasta que cambie el
// mes, y además consume el freno global por hora, que suma
// coalesce(real_usd, reservado_usd).
//
// Había TRES retornos que se iban sin devolverla:
//   • el tope inválido (503)
//   • el fallo del rate limit (503)
//   • la falta de OPENAI_API_KEY (500)
//
// El último era el peor: sin ese secreto puesto —despliegue nuevo, rotación de
// clave, proyecto de staging— cada petición de cada usuario cobraba su estimado
// SIN llamar a OpenAI ni una vez, hasta agotarles el presupuesto del mes. Y
// como cada reintento genera un requestId nuevo, reintentar volvía a cobrar.
//
// Un comentario que escribí yo afirmaba que solo había un retorno así. Había
// tres. Por eso este test no cuenta casos conocidos: exige que NINGUNA salida
// del tramo pase por json() directamente.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const proxy = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'functions', 'ai-proxy', 'index.ts'),
  'utf8'
);

/** El tramo en el que hay dinero apuntado, sin contar el cuerpo de salir(). */
function tramoConDinero(): string {
  const iAbre = proxy.indexOf('let reservaAbierta = true;');
  const iCierra = proxy.indexOf('await cuadrarReserva(costoReal);');
  assert.ok(iAbre > 0, 'no encontré dónde se abre la reserva');
  assert.ok(iCierra > iAbre, 'no encontré dónde se cuadra con el costo real');

  const tramo = proxy.slice(iAbre, iCierra);
  // salir() SÍ usa json(): es quien traduce a respuesta después de devolver.
  const iSalir = tramo.indexOf('async function salir(');
  assert.ok(iSalir > 0, 'no encontré salir()');
  const finSalir = tramo.indexOf('\n  }', iSalir);
  return tramo.slice(0, iSalir) + tramo.slice(finSalir);
}

test('ninguna salida del tramo responde sin devolver la reserva', () => {
  const tramo = tramoConDinero();
  const sueltos = [...tramo.matchAll(/return json\(/g)].length;
  assert.equal(
    sueltos,
    0,
    `${sueltos} retorno(s) responden con json() directo: ese dinero se queda cobrado`,
  );
});

test('y hay varias salidas que sí pasan por salir()', () => {
  // Si mañana alguien "arregla" el test borrando las salidas en vez de
  // cuadrarlas, esto lo nota.
  const tramo = tramoConDinero();
  const porSalir = [...tramo.matchAll(/return await salir\(/g)].length;
  assert.ok(porSalir >= 4, `solo ${porSalir} salidas pasan por salir(): la extracción falla o se perdieron caminos`);
});

test('la falta de OPENAI_API_KEY devuelve la reserva', () => {
  // Con nombre y apellido, para que no se lea como una regla abstracta.
  assert.match(
    proxy,
    /if \(!openaiKey\) return await salir\(/,
    'sin el secreto puesto se cobra a todo el mundo sin llamar a OpenAI ni una vez',
  );
});

test('cuadrarReserva se marca como hecha ANTES de llamar a la base', () => {
  // Si ajustar_ai falla, la reserva se queda puesta a propósito: cobra de más,
  // nunca de menos. Marcarla después dejaría que el finally la reintentara.
  const i = proxy.indexOf('async function cuadrarReserva');
  const cuerpo = proxy.slice(i, i + 600);
  assert.ok(
    cuerpo.indexOf('reservaAbierta = false;') < cuerpo.indexOf("rpc('ajustar_ai'"),
    'se marca después de la llamada',
  );
});

test('un remanente de cero NO se trata como presupuesto agotado', () => {
  // reservar_ai devuelve el presupuesto que queda DESPUÉS de reservar, y null
  // cuando no cabía (y entonces ella misma lo deshace). Un 0 es "cupo exacto,
  // reserva válida": cortar ahí tiraba una reserva ya cobrada.
  assert.ok(
    !/restante === null \|\| \(typeof restante === 'number' && restante <= 0\)/.test(proxy),
    'el 0 sigue tratándose como agotado: se tira una reserva legítima sin devolverla',
  );
  assert.match(proxy, /if \(restante === null\) \{/);
});
