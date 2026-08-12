// __tests__/firmaRelease.test.ts
// Si este plugin falla en silencio, el AAB sale firmado con la clave de
// depuración: se instala bien, arranca bien, y Play lo rechaza al subirlo.
// El fallo aparece al final del proceso más lento que tenemos, así que aquí
// se comprueba antes.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PLANTILLA_NATIVA } from '../scripts/plantillaNativa.mjs';

const requerir = createRequire(import.meta.url);
const { inyectarFirma } = requerir('../plugins/withFirmaRelease.js');

/**
 * Copia literal del bloque relevante de expo-template-bare-minimum@54.0.52.
 *
 * Qué prueba esto y qué NO. Esto es un SNAPSHOT: comprueba que la
 * transformación del plugin es correcta sobre un texto conocido. NO vigila el
 * paquete de npm — el literal está congelado aquí y nadie lo compara contra
 * upstream. (El comentario anterior afirmaba que sí, y no era verdad: la copia
 * ya se había quedado sin las dos últimas líneas del bloque `release`.)
 *
 * Lo que de verdad impide que la plantilla cambie bajo nuestros pies es fijar
 * la versión en scripts/plantillaNativa.mjs, porque `sdk-54` es un tag mutable.
 * El último test del archivo comprueba el android/app/build.gradle REAL cuando
 * existe, que es lo más cerca de la realidad que se puede estar sin compilar.
 */
const PLANTILLA = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
            shrinkResources enableShrinkResources.toBoolean()
            minifyEnabled enableMinifyInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
            def enablePngCrunchInRelease = findProperty('android.enablePngCrunchInReleaseBuilds') ?: 'true'
            crunchPngs enablePngCrunchInRelease.toBoolean()
        }
    }
}`;

test('el buildType release deja de usar la keystore de depuración', () => {
  const out = inyectarFirma(PLANTILLA);
  const release = out.slice(out.indexOf('release {', out.indexOf('buildTypes')));
  assert.ok(
    release.includes('signingConfig signingConfigs.release'),
    'release debe firmar con la keystore de subida',
  );
  assert.ok(
    !release.includes('signingConfig signingConfigs.debug'),
    'no debe quedar ni rastro de la firma de depuración en release',
  );
});

test('el buildType debug se queda como estaba', () => {
  // Tocarlo rompería `expo run:android` y el desarrollo diario sin que el
  // arreglo de release lo necesite para nada.
  const out = inyectarFirma(PLANTILLA);
  const debug = out.slice(out.indexOf('debug {', out.indexOf('buildTypes')));
  assert.ok(debug.includes('signingConfig signingConfigs.debug'));
});

/**
 * El signingConfig `release`, aislado. Recorta contando llaves y no por
 * posición: dentro de `signingConfigs` están `release` y `debug`, y este
 * bloque tiene que quedar fuera del examen — la clave de depuración sí lleva
 * su contraseña escrita, y colarla aquí haría fallar al test por lo contrario
 * de lo que quiere comprobar.
 */
function bloqueFirmaRelease(gradle: string): string {
  const configs = gradle.slice(gradle.indexOf('signingConfigs {'), gradle.indexOf('buildTypes'));
  const inicio = configs.indexOf('release {');
  assert.notEqual(inicio, -1, 'no hay signingConfig release');

  let profundidad = 0;
  for (let i = configs.indexOf('{', inicio); i < configs.length; i++) {
    if (configs[i] === '{') profundidad++;
    else if (configs[i] === '}' && --profundidad === 0) return configs.slice(inicio, i + 1);
  }
  throw new Error('el signingConfig release no cierra');
}

test('las contraseñas de subida se leen de gradle.properties, no se incrustan', () => {
  const out = inyectarFirma(PLANTILLA);
  const release = bloqueFirmaRelease(out);

  assert.ok(release.includes("project.hasProperty('GYMUP_UPLOAD_STORE_FILE')"));
  assert.ok(release.includes('storePassword GYMUP_UPLOAD_STORE_PASSWORD'));
  assert.ok(release.includes('keyPassword GYMUP_UPLOAD_KEY_PASSWORD'));

  // Ninguna credencial literal en el bloque de release. Se mira SOLO aquí: el
  // bloque `debug` sí lleva 'android' escrito a mano, y con razón — es la clave
  // de depuración pública de Android, igual en todas las máquinas del mundo.
  assert.ok(
    !/(storePassword|keyPassword|keyAlias|storeFile file\() *['"]/.test(release),
    'el signingConfig de release no puede llevar credenciales escritas en el archivo',
  );
});

test('sin keystore configurada, un build de release falla en voz alta', () => {
  // El modo peligroso sería continuar y firmar con la de depuración.
  const out = inyectarFirma(PLANTILLA);
  assert.match(out, /throw new GradleException/);
  assert.match(out, /BUILD_LOCAL\.md/);
});

test('un build de depuración NO falla por no tener la keystore', () => {
  const out = inyectarFirma(PLANTILLA);
  assert.match(out, /taskNames\.any \{ it\.toLowerCase\(\)\.contains\('release'\) \}/);
});

test('aplicarlo dos veces no duplica nada', () => {
  // Los config plugins se pueden evaluar más de una vez en un mismo prebuild.
  const una = inyectarFirma(PLANTILLA);
  const dos = inyectarFirma(una);
  assert.equal(una, dos);
});

test('el snapshot corresponde a la versión de plantilla que se compila', () => {
  // Si alguien sube PLANTILLA_NATIVA sin actualizar el literal de arriba, el
  // snapshot deja de representar lo que prebuild genera y este archivo pasa a
  // dar una seguridad falsa.
  assert.equal(PLANTILLA_NATIVA, '54.0.52');
});

test('el android/app/build.gradle real quedó firmado con la keystore de subida', (t) => {
  // El único test que mira la realidad y no un literal. android/ está en
  // .gitignore y solo existe después de un prebuild, así que se salta cuando
  // no está en vez de fallar.
  const gradle = path.join(process.cwd(), 'android', 'app', 'build.gradle');
  if (!fs.existsSync(gradle)) {
    t.skip('no hay android/ generado todavía');
    return;
  }

  const contenido = fs.readFileSync(gradle, 'utf8');
  const release = bloqueFirmaRelease(contenido);
  assert.ok(release.includes('GYMUP_UPLOAD_STORE_FILE'), 'el plugin no inyectó el signingConfig');
  assert.ok(
    /release \{[\s\S]*?signingConfig signingConfigs\.release/.test(
      contenido.slice(contenido.indexOf('buildTypes')),
    ),
    'el buildType release no está usando la keystore de subida',
  );
});

test('si Expo cambia la plantilla, el plugin lanza en vez de seguir', () => {
  // Este es el test que de verdad importa: un plugin que no encuentra su ancla
  // y devuelve el texto intacto produce justo el AAB mal firmado que venía a
  // evitar, y encima sin avisar.
  const sinAncla = PLANTILLA.replace(/signingConfigs \{/, 'firmas {');
  assert.throws(() => inyectarFirma(sinAncla), /signingConfigs/);

  const releaseCambiado = PLANTILLA.replace(
    '            // Caution! In production, you need to generate your own keystore file.',
    '            // Comentario nuevo de una version futura',
  );
  assert.throws(() => inyectarFirma(releaseCambiado), /release/);
});
