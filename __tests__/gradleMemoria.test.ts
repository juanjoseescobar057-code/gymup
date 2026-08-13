// __tests__/gradleMemoria.test.ts
// Este plugin existe porque un build de 45 minutos murió en el minuto 32 por
// quedarse sin recursos. Si escribe mal gradle.properties —duplicando una
// clave, o añadiendo en vez de reemplazar— el ajuste no surte efecto y el
// siguiente build vuelve a morir igual, después de otros 32 minutos.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const requerir = createRequire(import.meta.url);
const { AJUSTES, ponerPropiedad } = requerir('../plugins/withGradleMemoria.js');

type Item = { type: string; key?: string; value: string };

/** gradle.properties tal como lo genera la plantilla de Expo. */
const GENERADO: Item[] = [
  { type: 'comment', value: 'Project-wide Gradle settings.' },
  { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx2048m -XX:MaxMetaspaceSize=512m' },
  { type: 'property', key: 'org.gradle.parallel', value: 'true' },
  { type: 'property', key: 'android.useAndroidX', value: 'true' },
];

test('reemplaza una propiedad existente en vez de añadir otra igual', () => {
  // Duplicar la clave es el fallo silencioso: Gradle se queda con una de las
  // dos y no avisa, así que el build parece configurado y no lo está.
  const salida = ponerPropiedad(GENERADO, 'org.gradle.jvmargs', '-Xmx3072m');
  const jvmargs = salida.filter((i: Item) => i.key === 'org.gradle.jvmargs');
  assert.equal(jvmargs.length, 1);
  assert.equal(jvmargs[0].value, '-Xmx3072m');
});

test('añade la propiedad si no estaba', () => {
  const salida = ponerPropiedad(GENERADO, 'org.gradle.workers.max', '2');
  assert.equal(salida.find((i: Item) => i.key === 'org.gradle.workers.max')?.value, '2');
});

test('no toca las demás propiedades ni los comentarios', () => {
  const salida = ponerPropiedad(GENERADO, 'org.gradle.jvmargs', '-Xmx3072m');
  assert.equal(salida.find((i: Item) => i.key === 'android.useAndroidX')?.value, 'true');
  assert.equal(salida.filter((i: Item) => i.type === 'comment').length, 1);
});

test('sube el heap por encima del valor de la plantilla', () => {
  // 2048m fue justo lo que no alcanzó. Que el ajuste no lo BAJE por descuido.
  const jvmargs = AJUSTES.find((a: { key: string }) => a.key === 'org.gradle.jvmargs');
  const mb = Number(jvmargs.value.match(/-Xmx(\d+)m/)![1]);
  assert.ok(mb > 2048, `el heap debe superar los 2048m de la plantilla, es ${mb}m`);
  // Y que no se pase: esta máquina tiene 16 GB y además corre Metro y Kotlin.
  // Pedir demasiado provoca intercambio a disco, que es peor que ir justo.
  assert.ok(mb <= 4096, `${mb}m es demasiado para una máquina de 16 GB con Metro corriendo`);
});

test('limita los procesos hijo: 4 núcleos no dan para 4 workers', () => {
  const workers = AJUSTES.find((a: { key: string }) => a.key === 'org.gradle.workers.max');
  assert.ok(workers, 'sin límite de workers vuelve el mismo fallo');
  assert.ok(Number(workers.value) <= 2);
});

test('cada ajuste explica por qué está', () => {
  // Dentro de seis meses, "¿por qué 2 workers?" tiene que responderse solo.
  for (const a of AJUSTES) {
    assert.ok(a.porque && a.porque.length > 20, `${a.key} sin explicación`);
  }
});

test('aplicarlo dos veces deja el archivo igual', () => {
  let items: Item[] = GENERADO;
  for (const a of AJUSTES) items = ponerPropiedad(items, a.key, a.value);
  const unaVez = JSON.stringify(items);
  for (const a of AJUSTES) items = ponerPropiedad(items, a.key, a.value);
  assert.equal(JSON.stringify(items), unaVez);
});
