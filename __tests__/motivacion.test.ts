// __tests__/motivacion.test.ts
// El humor es un arma cargada. "Tu ex lleva una semana entrenando" hace gracia
// a casi todo el mundo y es un disparador para quien está saliendo de un
// trastorno de la conducta alimentaria. Estos tests existen para que la broma
// no llegue nunca a quien no debe.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mensajeDeRegreso } from '../lib/motivacion';

const conHumor = (dias: number, semilla = 7) =>
  mensajeDeRegreso({ dias, sinComparaciones: false, semilla });
const sinHumor = (dias: number, semilla = 7) =>
  mensajeDeRegreso({ dias, sinComparaciones: true, semilla });

// ── Cuándo hablar ──

test('a quien entrenó ayer no se le dice nada', () => {
  assert.equal(conHumor(0), null);
  assert.equal(conHumor(-3), null);
});

test('un número absurdo no rompe nada', () => {
  assert.equal(mensajeDeRegreso({ dias: NaN, sinComparaciones: false, semilla: 1 }), null);
  assert.ok(conHumor(9999));
});

test('el título dice el número exacto de días', () => {
  assert.equal(conHumor(1)!.titulo, 'Un día sin entrenar');
  assert.equal(conHumor(12)!.titulo, '12 días sin entrenar');
});

// ── El modo recuperación no ve ni una broma ──

test('en modo recuperación nunca hay pique, en ningún tramo', () => {
  for (const d of [1, 4, 9, 20, 60]) {
    assert.equal(sinHumor(d)!.conHumor, false, `${d} días: se coló humor`);
  }
});

test('en modo recuperación no aparece NADIE con quien compararse', () => {
  for (const d of [1, 4, 9, 20, 60]) {
    for (let s = 0; s < 6; s++) {
      const t = sinHumor(d, s)!.cuerpo.toLowerCase();
      assert.ok(!/tu ex|otra persona|los demás|que tú|más que/.test(t), `${d}/${s}: "${t}"`);
    }
  }
});

test('los mensajes neutros hablan de la persona, no de su cuerpo', () => {
  // El modo recuperación oculta peso y calorías en toda la app; sería absurdo
  // que el mensaje de bienvenida los trajera de vuelta.
  for (const d of [4, 20, 60]) {
    for (let s = 0; s < 6; s++) {
      const t = sinHumor(d, s)!.cuerpo.toLowerCase();
      assert.ok(!/peso|kilo|calor|grasa|figura|cuerpo|barriga/.test(t), `${d}/${s}: "${t}"`);
    }
  }
});

// ── El humor, cuando aplica ──

test('faltar un día no se bromea', () => {
  // Bromear con una pausa de un día enseña que la app juzga cada ausencia.
  assert.equal(conHumor(1)!.conHumor, false);
  assert.equal(conHumor(2)!.conHumor, false);
});

test('a partir de tres días sí entra el pique', () => {
  assert.equal(conHumor(4)!.conHumor, true);
  assert.equal(conHumor(10)!.conHumor, true);
});

test('el humor va sobre constancia, nunca sobre cuerpos', () => {
  // La diferencia entre "tu ex lleva tres semanas entrenando" y "tu ex está
  // más en forma que tú" es la diferencia entre una broma y un motivo para
  // desinstalar.
  for (const d of [4, 9, 20, 60]) {
    for (let s = 0; s < 8; s++) {
      const t = conHumor(d, s)!.cuerpo.toLowerCase();
      assert.ok(
        !/(más|mejor) (en forma|delgad|fuerte)|tu peso|tu cuerpo|gordo|flaco|barriga/.test(t),
        `${d}/${s}: "${t}"`,
      );
    }
  }
});

test('nunca insulta ni da órdenes', () => {
  for (const d of [4, 9, 20, 60]) {
    for (let s = 0; s < 8; s++) {
      const t = conHumor(d, s)!.cuerpo.toLowerCase();
      assert.ok(!/vago|flojo|excusas|deja de|ponte las pilas/.test(t), `${d}/${s}: "${t}"`);
    }
  }
});

// ── Estable dentro del día, distinto entre días ──

test('la misma semilla da siempre el mismo mensaje', () => {
  // Si cambiara en cada repintado, la pantalla parpadearía con textos distintos.
  assert.equal(conHumor(10, 3)!.cuerpo, conHumor(10, 3)!.cuerpo);
});

test('semillas distintas recorren varios mensajes', () => {
  const vistos = new Set<string>();
  for (let s = 0; s < 10; s++) vistos.add(conHumor(10, s)!.cuerpo);
  assert.ok(vistos.size > 1, 'siempre sale el mismo texto');
});

test('una semilla negativa o enorme no se sale del array', () => {
  for (const s of [-99, 1e9, 0]) {
    assert.ok(conHumor(10, s)!.cuerpo.length > 0, `semilla ${s} devolvió vacío`);
  }
});

// ── Todos los tramos tienen texto ──

test('ningún tramo se queda sin mensaje, con o sin humor', () => {
  for (const d of [1, 2, 3, 6, 7, 13, 14, 29, 30, 365]) {
    assert.ok((conHumor(d)?.cuerpo.length ?? 0) > 0, `${d} días sin texto (humor)`);
    assert.ok((sinHumor(d)?.cuerpo.length ?? 0) > 0, `${d} días sin texto (neutro)`);
  }
});
