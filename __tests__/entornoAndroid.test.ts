// __tests__/entornoAndroid.test.ts
// Comprobar el SDK antes de compilar solo sirve si la comprobación es
// correcta. Un falso verde aquí devuelve el problema que venía a evitar —
// esperar los tests y el prebuild entero para que Gradle muera pidiendo un NDK
// que nadie sabía que hacía falta.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  versionesRequeridas,
  revisarSdk,
  mensajeFaltantes,
  rutaConEspacios,
} from '../scripts/entornoAndroid.mjs';

const CATALOGO = `[versions]
# Android versions
minSdk = "24"
targetSdk = "36"
compileSdk = "36"
buildTools = "36.0.0"
ndkVersion = "27.1.12297006"
# Dependencies versions
agp = "8.11.0"
`;

const COMPLETO = {
  platforms: ['android-36'],
  buildTools: ['36.0.0'],
  platformTools: true,
  ndk: ['27.1.12297006'],
  cmake: ['3.22.1'],
};

// ── Leer lo que el proyecto exige ──

test('saca las versiones del catálogo de React Native', () => {
  assert.deepEqual(versionesRequeridas(CATALOGO), {
    compileSdk: '36',
    buildTools: '36.0.0',
    ndkVersion: '27.1.12297006',
  });
});

test('un catálogo con otro formato devuelve null, no valores a medias', () => {
  // Quien llama tiene que tratarlo como error. Rellenar con valores por
  // defecto significaría comprobar contra un NDK inventado.
  assert.equal(versionesRequeridas('[versions]\nminSdk = "24"\n'), null);
  assert.equal(versionesRequeridas(''), null);
});

test('lee el catálogo real del proyecto, no solo el de ejemplo', () => {
  // Si React Native cambia el formato del archivo en una actualización, este
  // test avisa antes de que el guardia empiece a decir que falta todo.
  const real = path.join(process.cwd(), 'node_modules', 'react-native', 'gradle', 'libs.versions.toml');
  if (!fs.existsSync(real)) return; // sin node_modules (CI de solo lectura)

  const v = versionesRequeridas(fs.readFileSync(real, 'utf8'));
  assert.ok(v, 'el catálogo real ya no tiene el formato que espera el guardia');
  assert.match(v!.compileSdk, /^\d+$/);
  assert.match(v!.ndkVersion, /^\d+\.\d+\.\d+$/);
});

// ── Comparar contra lo instalado ──

test('con todo instalado no falta nada', () => {
  assert.deepEqual(revisarSdk(versionesRequeridas(CATALOGO)!, COMPLETO), []);
});

test('android-37 NO sirve para un proyecto que pide compileSdk 36', () => {
  // El caso que se dio de verdad. Son paquetes distintos, no una versión más
  // nueva que valga igual: Gradle pide la 36 concreta.
  const faltan = revisarSdk(versionesRequeridas(CATALOGO)!, { ...COMPLETO, platforms: ['android-37.0'] });
  assert.equal(faltan.length, 1);
  assert.match(faltan[0].que, /Platform 36/);
  assert.match(faltan[0].detalle, /android-37\.0/); // dice qué hay, no solo qué falta
});

test('sin NDK avisa, y explica por qué hace falta', () => {
  const faltan = revisarSdk(versionesRequeridas(CATALOGO)!, { ...COMPLETO, ndk: [] });
  assert.equal(faltan.length, 1);
  assert.match(faltan[0].que, /27\.1\.12297006/);
  assert.match(faltan[0].detalle, /C\+\+/);
});

test('un NDK de otra versión no cuenta como tenerlo', () => {
  const faltan = revisarSdk(versionesRequeridas(CATALOGO)!, { ...COMPLETO, ndk: ['26.1.10909125'] });
  assert.equal(faltan.length, 1);
});

test('sin CMake avisa: es lo que dispara la compilación nativa', () => {
  const faltan = revisarSdk(versionesRequeridas(CATALOGO)!, { ...COMPLETO, cmake: [] });
  assert.match(faltan[0].que, /CMake/);
});

test('un SDK vacío no revienta: enumera todo lo que falta', () => {
  const faltan = revisarSdk(versionesRequeridas(CATALOGO)!, {});
  assert.equal(faltan.length, 5);
});

// ── El espacio en la ruta del SDK ──
// Costó 32 minutos de compilación descubrirlo, y el error final no mencionaba
// la ruta por ningún lado: cientos de "undefined symbol" de la STL.

test('una ruta con espacios se rechaza', () => {
  const m = rutaConEspacios('C:\\Users\\Juan Escobar\\AppData\\Local\\Android\\Sdk');
  assert.ok(m, 'un espacio en la ruta del SDK rompe la compilación de C++ en Windows');
});

test('una ruta sin espacios pasa', () => {
  assert.equal(rutaConEspacios('C:\\Android\\Sdk'), null);
  assert.equal(rutaConEspacios('/home/juan/Android/Sdk'), null);
});

test('el mensaje explica el mecanismo, no solo "hay un espacio"', () => {
  // Sin el porqué, la reacción natural es pensar que es una manía y saltárselo.
  const m = rutaConEspacios('C:\\Users\\Juan Escobar\\Sdk')!;
  assert.match(m, /CLANG_~1/);          // el nombre corto que pierde los ++
  assert.match(m, /clang\+\+/);
  assert.match(m, /undefined symbol/);   // el error que verá si lo ignora
  assert.match(m, /ANDROID_HOME/);       // y qué hacer
});

test('el mensaje propone la ruta concreta a mover, no una genérica', () => {
  // Un mensaje que diga "muévelo a una ruta sin espacios" obliga a componer el
  // comando a mano, con la ruta que precisamente tiene espacios y hay que
  // entrecomillar. Mejor darlo hecho.
  const sdk = 'C:\\Users\\Juan Escobar\\AppData\\Local\\Android\\Sdk';
  assert.ok(rutaConEspacios(sdk)!.includes(`Move-Item "${sdk}" "C:\\Android\\Sdk"`));
});

test('el mensaje dice dónde se instala cada cosa', () => {
  // Un error que solo dice "falta el NDK" deja al usuario buscando en Google.
  const texto = mensajeFaltantes(revisarSdk(versionesRequeridas(CATALOGO)!, {}));
  assert.match(texto, /SDK Manager/);
  assert.match(texto, /Show Package Details/); // sin esto no se puede elegir la versión del NDK
  assert.match(texto, /27\.1\.12297006/);
});
