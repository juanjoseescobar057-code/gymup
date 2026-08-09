// __tests__/aiErrores.test.ts
// El cuerpo de un error de OpenAI puede citar el prompt, y el prompt lleva las
// directivas de salud de la persona. Antes se mandaban 200 caracteres de ese
// cuerpo a Sentry "truncados"; truncar no es sanear — los primeros 200
// caracteres son justo donde empieza a citarse el prompt.
//
// Estos tests fijan que lo que sale de aquí sea una CATEGORÍA y nunca texto.

import test from 'node:test';
import assert from 'node:assert/strict';
import { codigoDeError } from '../lib/aiErrorCodes';

test('clasifica los fallos que de verdad se ven en producción', () => {
  assert.equal(codigoDeError('{"error":{"code":"rate_limit_exceeded"}}'), 'rate_limit');
  assert.equal(codigoDeError('insufficient_quota: you exceeded your current quota'), 'sin_cuota');
  assert.equal(codigoDeError('{"error":{"code":"context_length_exceeded"}}'), 'contexto_demasiado_largo');
  assert.equal(codigoDeError('The model `gpt-9` does not exist'), 'modelo_inexistente');
  assert.equal(codigoDeError('server_error: overloaded'), 'proveedor_saturado');
});

test('NUNCA devuelve un fragmento del cuerpo', () => {
  // El caso peligroso: un error que cita el prompt con datos clínicos.
  const cuerpo = JSON.stringify({
    error: {
      message: 'Invalid request. Prompt was: HERNIA DISCAL: PROHIBIDO peso muerto. ' +
        'El usuario Juan, 34 años, 82 kg, declara dolor lumbar irradiado…',
    },
  });
  const codigo = codigoDeError(cuerpo);
  assert.equal(codigo, 'sin_clasificar');
  assert.doesNotMatch(codigo, /HERNIA|Juan|82|lumbar/i);
  // Y el resultado es siempre una etiqueta corta, nunca contenido.
  assert.ok(codigo.length < 40);
});

test('un cuerpo vacío se distingue de uno sin clasificar', () => {
  // Sirve para diagnosticar: "no vino nada" y "vino algo que no reconozco"
  // son fallos distintos.
  assert.equal(codigoDeError(''), 'cuerpo_vacio');
  assert.equal(codigoDeError('   '), 'cuerpo_vacio');
  assert.equal(codigoDeError('algo raro'), 'sin_clasificar');
});

test('el conjunto de códigos posibles es cerrado y corto', () => {
  const muestras = ['rate_limit_exceeded', 'quota', 'content_policy', 'context_length',
    'model_not_found', 'unauthorized', 'timeout', 'overloaded', '', 'xyz'];
  const codigos = new Set(muestras.map(codigoDeError));
  for (const c of codigos) {
    assert.match(c, /^[a-z_]+$/, `"${c}" no parece una etiqueta cerrada`);
  }
});
