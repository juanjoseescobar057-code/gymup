// __tests__/preflight.test.ts
// El preflight es la puerta que decide si una sesión en vivo puede empezar.
// Si se equivoca hacia "ready", el usuario entrena creyendo que lo estamos
// contando y las reps salen mal; si se equivoca hacia "no_person", la función
// principal de la app queda bloqueada sin explicación. Ambos lados importan.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluarEncuadre,
  copyPreflight,
  articulacionesRequeridas,
  SPAN_MIN,
  SPAN_MAX,
  resumirSesion,
} from '../lib/pose/preflight';
import type { Joint, Pose } from '../lib/pose/types';

/** Construye una pose con las articulaciones dadas repartidas verticalmente. */
function poseCon(joints: Joint[], opts: { span?: number; score?: number; eje?: 'y' | 'x' } = {}): Pose {
  const span = opts.span ?? 0.7;
  const score = opts.score ?? 0.9;
  const eje = opts.eje ?? 'y';
  const p: Pose = {};
  joints.forEach((j, i) => {
    const t = joints.length === 1 ? 0 : i / (joints.length - 1);
    const v = 0.02 + t * span;
    p[j] = eje === 'y' ? { x: 0.5, y: v, score } : { x: v, y: 0.5, score };
  });
  return p;
}

const CUERPO = articulacionesRequeridas('squat');

test('sin pose no inventa a nadie', () => {
  assert.equal(evaluarEncuadre(null, 'squat'), 'no_person');
  assert.equal(evaluarEncuadre(undefined, 'squat'), 'no_person');
  assert.equal(evaluarEncuadre({}, 'squat'), 'no_person');
});

test('keypoints por debajo del umbral de confianza no cuentan como persona', () => {
  const fantasma = poseCon(CUERPO, { score: 0.1 });
  assert.equal(evaluarEncuadre(fantasma, 'squat'), 'no_person');
});

test('torso visible pero sin piernas es cuerpo parcial, no listo', () => {
  const medio = poseCon(['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip']);
  assert.equal(evaluarEncuadre(medio, 'squat'), 'partial_body');
});

test('cuerpo completo bien encuadrado da ready', () => {
  assert.equal(evaluarEncuadre(poseCon(CUERPO, { span: 0.7 }), 'squat'), 'ready');
});

test('persona diminuta en el cuadro es too_far', () => {
  const lejos = poseCon(CUERPO, { span: SPAN_MIN - 0.1 });
  assert.equal(evaluarEncuadre(lejos, 'squat'), 'too_far');
});

test('persona que toca los bordes es too_close', () => {
  const cerca = poseCon(CUERPO, { span: SPAN_MAX + 0.02 });
  assert.equal(evaluarEncuadre(cerca, 'squat'), 'too_close');
});

test('las flexiones se miden en horizontal: un cuerpo tumbado no es "muy lejos"', () => {
  // Mismo cuerpo, acostado: el alto es mínimo pero el ancho es correcto.
  const tumbado = poseCon(articulacionesRequeridas('pushup'), { span: 0.75, eje: 'x' });
  assert.equal(evaluarEncuadre(tumbado, 'pushup'), 'ready');
});

test('el curl de bíceps no exige tobillos', () => {
  const req = articulacionesRequeridas('biceps_curl');
  assert.ok(!req.includes('leftAnkle'));
  const soloTren = poseCon(req, { span: 0.6 });
  assert.equal(evaluarEncuadre(soloTren, 'biceps_curl'), 'ready');
  // El mismo encuadre NO alcanza para una sentadilla.
  assert.equal(evaluarEncuadre(soloTren, 'squat'), 'partial_body');
});

test('un ejercicio desconocido cae en cuerpo completo, no en "lo que sea"', () => {
  assert.deepEqual(articulacionesRequeridas('no_existe'), CUERPO);
});

test('solo ready habilita el arranque', () => {
  const estados = [
    'no_person', 'partial_body', 'too_close', 'too_far',
    'camera_denied', 'model_unavailable', 'device_not_supported',
  ] as const;
  for (const e of estados) {
    assert.equal(copyPreflight(e).listo, false, `${e} no debería habilitar`);
  }
  assert.equal(copyPreflight('ready').listo, true);
});

test('cada estado explica qué hacer, no solo qué falla', () => {
  const estados = [
    'ready', 'no_person', 'partial_body', 'too_close', 'too_far',
    'camera_denied', 'model_unavailable', 'device_not_supported',
  ] as const;
  for (const e of estados) {
    const c = copyPreflight(e);
    assert.ok(c.titulo.length > 0, `${e} sin título`);
    assert.ok(c.detalle.length > 10, `${e} sin detalle accionable`);
  }
});

// ── Resumen de la sesión ──
// Decide si le avisamos al usuario de que su conteo puede estar mal. Callarlo
// cuando la cámara lo perdió la mitad del tiempo es dejarle creer un número
// inventado; avisar siempre es ruido que enseña a ignorar el aviso.

test('detección limpia no dispara el aviso', () => {
  const r = resumirSesion(100, 95, new Map());
  assert.equal(r.deteccionIncompleta, false);
});

test('la cámara perdiendo a la persona la mitad del tiempo sí avisa', () => {
  const r = resumirSesion(100, 50, new Map());
  assert.equal(r.deteccionIncompleta, true);
});

test('sin frames procesados se avisa: no medir no es medir bien', () => {
  const r = resumirSesion(0, 0, new Map());
  assert.equal(r.calidad, 0);
  assert.equal(r.deteccionIncompleta, true);
});

test('se lleva las tres correcciones MÁS REPETIDAS, no las últimas', () => {
  const cues = new Map([
    ['rodillas adentro', 12],
    ['espalda redondeada', 3],
    ['poca profundidad', 8],
    ['talones levantados', 1],
    ['codos abiertos', 5],
  ]);
  const r = resumirSesion(100, 90, cues);
  assert.deepEqual(r.topCues, ['rodillas adentro', 'poca profundidad', 'codos abiertos']);
});

test('sin correcciones no se inventa ninguna', () => {
  assert.deepEqual(resumirSesion(100, 90, new Map()).topCues, []);
});
