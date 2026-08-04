// __tests__/contrast.test.ts
// ─────────────────────────────────────────────────────────
// El contraste deja de ser una opinión: se comprueba.
//
// El apéndice de la auditoría de UX pide explícitamente "no volver a textos
// #555555 sobre fondo casi negro". Un comentario no lo impide; esta suite sí.
// ─────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contraste, cumpleTextoNormal, cumpleTextoGrande, parseColor } from '../lib/contrast.ts';
import { Colors } from '../constants/theme.ts';

test('parseColor entiende hex corto, largo y rgba', () => {
  assert.deepEqual(parseColor('#fff'), [255, 255, 255]);
  assert.deepEqual(parseColor('#0e0e10'), [14, 14, 16]);
  assert.deepEqual(parseColor('rgba(200,255,62,0.12)'), [200, 255, 62]);
});

test('el contraste de referencia es correcto', () => {
  // Blanco sobre negro = 21:1, el máximo posible.
  assert.equal(Math.round(contraste('#ffffff', '#000000')), 21);
  // Un color consigo mismo = 1:1.
  assert.equal(Math.round(contraste('#123456', '#123456')), 1);
});

test('el gris de la versión anterior NO habría pasado', () => {
  // #555555 sobre el fondo daba ~2.6:1 y se usaba para instrucciones.
  // Se deja como prueba viva de por qué existe este archivo.
  assert.equal(cumpleTextoNormal('#555555', Colors.bg), false);
  assert.ok(contraste('#555555', Colors.bg) < 3);
});

// ── Los textos legibles cumplen AA sobre AMBOS fondos ────
// bgCard es más claro que bg, así que es el caso más exigente de los dos.
for (const fondo of ['bg', 'bgCard', 'bgInput'] as const) {
  for (const texto of ['textPrimary', 'textSecondary', 'textMuted'] as const) {
    test(`${texto} sobre ${fondo} cumple 4.5:1`, () => {
      const ratio = contraste(Colors[texto], Colors[fondo]);
      assert.ok(
        ratio >= 4.5,
        `${texto} sobre ${fondo} da ${ratio.toFixed(2)}:1, se exige 4.5:1`
      );
    });
  }
}

// ── Colores semánticos: se usan en texto corto y en iconos ──
for (const semantico of ['accent', 'warning', 'error', 'info', 'success', 'premium'] as const) {
  test(`${semantico} sobre bgCard cumple 3:1 (texto grande / no textual)`, () => {
    const ratio = contraste(Colors[semantico], Colors.bgCard);
    assert.ok(
      ratio >= 3,
      `${semantico} sobre bgCard da ${ratio.toFixed(2)}:1, se exige 3:1`
    );
  });
}

test('el texto sobre el botón de acento es legible', () => {
  // Los CTA primarios son verde sólido con texto oscuro encima.
  assert.ok(cumpleTextoNormal('#0a0a0b', Colors.accent));
});

test('textDisabled NO cumple AA, y eso es intencional', () => {
  // Si algún día pasara a cumplir, dejaría de comunicar "deshabilitado" y
  // alguien lo usaría para texto normal — que es como empezó este problema.
  assert.equal(cumpleTextoNormal(Colors.textDisabled, Colors.bg), false);
  // Aun así debe distinguirse del fondo lo suficiente para verse.
  assert.ok(cumpleTextoGrande(Colors.textDisabled, Colors.bg));
});

test('premium no es el verde de acción', () => {
  // El mismo verde significaba "toca aquí", "esto está elegido" y "esto se
  // paga". Premium tiene color propio.
  assert.notEqual(Colors.premium, Colors.accent);
});
