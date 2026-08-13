// scripts/build-android.mjs
// ─────────────────────────────────────────────────────────
// Compilar el AAB de producción en local, con lo que EAS hacía por su cuenta.
//
// Compilar a mano con `./gradlew bundleRelease` funciona, pero se salta tres
// cosas que el build de EAS sí hacía, y las tres fallan en silencio:
//
//   1. El hook `eas-build-pre-install` (el informe de revisiones pendientes).
//      En local no lo dispara nadie.
//   2. SENTRY_DISABLE_AUTO_UPLOAD=true, que estaba en las variables de EAS.
//      Sin ella el plugin de Sentry intenta subir los source maps con un token
//      que no existe en esta máquina.
//   3. `npm run verify` (secretos, tipos y tests), que corría en el servidor.
//
// Y añade tres comprobaciones que EAS no necesitaba, todas ANTES de compilar
// para no descubrir el problema al final de media hora:
//
//   - Que el SDK de Android tenga la plataforma, el NDK y CMake que este
//     proyecto exige. Los servidores de EAS venían con todo puesto.
//   - Que la keystore de subida esté configurada. Sin ella el build se cae
//     igual (lo impide plugins/withFirmaRelease.js), pero se cae al final.
//   - Que no haya ningún `.env*.local`. En EAS daba igual porque esos archivos
//     nunca llegaban al servidor; en local tienen prioridad sobre `.env`.
//
//   npm run build:android
// ─────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { revisarEnv } from './envConsistencia.mjs';
import { versionesRequeridas, revisarSdk, mensajeFaltantes, rutaConEspacios } from './entornoAndroid.mjs';
import { PLANTILLA_NATIVA } from './plantillaNativa.mjs';

const raiz = process.cwd();
const esWindows = process.platform === 'win32';

function paso(titulo) {
  console.log(`\n\x1b[1m── ${titulo}\x1b[0m`);
}

function morir(mensaje) {
  console.error(`\n\x1b[31m✖ ${mensaje}\x1b[0m\n`);
  process.exit(1);
}

function correr(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: esWindows, ...opts });
  if (r.status !== 0) morir(`Falló: ${cmd} ${args.join(' ')}`);
}

// ── 0. El SDK de Android, antes que nada ──

paso('Comprobando el entorno de Android');

const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!androidHome) {
  morir(
    'ANDROID_HOME no está definida, así que Gradle no sabe dónde está el SDK.\n\n' +
      '  PowerShell:\n' +
      `  [Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\\Android\\Sdk", 'User')\n\n` +
      '  Y CIERRA la terminal y abre otra: las variables solo se leen al abrir.',
  );
}
if (!fs.existsSync(androidHome)) {
  morir(`ANDROID_HOME apunta a una carpeta que no existe:\n  ${androidHome}`);
}

// Antes que nada: un espacio aquí no falla hasta el minuto 30, y el error que
// da entonces no menciona la ruta por ningún lado. Ver rutaConEspacios().
const problemaEspacios = rutaConEspacios(androidHome);
if (problemaEspacios) morir(problemaEspacios);

const catalogoRn = path.join(raiz, 'node_modules', 'react-native', 'gradle', 'libs.versions.toml');
if (!fs.existsSync(catalogoRn)) {
  morir(`No encuentro el catálogo de versiones de React Native:\n  ${catalogoRn}\n  ¿Falta un npm install?`);
}

const requeridas = versionesRequeridas(fs.readFileSync(catalogoRn, 'utf8'));
if (!requeridas) {
  // Seguir sin saber qué se exige sería comprobar nada y decir que todo está bien.
  morir(`No pude leer compileSdk/buildTools/ndkVersion de:\n  ${catalogoRn}\n  Cambió de formato: hay que revisar scripts/entornoAndroid.mjs.`);
}

const listar = (sub) => {
  const p = path.join(androidHome, sub);
  return fs.existsSync(p) ? fs.readdirSync(p) : [];
};

const faltan = revisarSdk(requeridas, {
  platforms: listar('platforms'),
  buildTools: listar('build-tools'),
  platformTools: fs.existsSync(path.join(androidHome, 'platform-tools')),
  ndk: listar('ndk'),
  cmake: listar('cmake'),
});

if (faltan.length) morir(mensajeFaltantes(faltan));
console.log(
  `  ✔ SDK ${requeridas.compileSdk}, build-tools ${requeridas.buildTools} y NDK ${requeridas.ndkVersion}`,
);

// ── 1. La keystore, antes de gastar media hora compilando ──

paso('Comprobando la keystore de subida');

const gradleProps = path.join(os.homedir(), '.gradle', 'gradle.properties');
if (!fs.existsSync(gradleProps)) {
  morir(
    `No existe ${gradleProps}.\n` +
      `  Sin la keystore de subida, Play rechazaría el AAB por certificado incorrecto.\n` +
      `  Ver docs/BUILD_LOCAL.md, apartado "Configurar la firma fuera del repo".`,
  );
}

const props = fs.readFileSync(gradleProps, 'utf8');
const REQUERIDAS = [
  'GYMUP_UPLOAD_STORE_FILE',
  'GYMUP_UPLOAD_STORE_PASSWORD',
  'GYMUP_UPLOAD_KEY_ALIAS',
  'GYMUP_UPLOAD_KEY_PASSWORD',
];
const faltanProps = REQUERIDAS.filter((k) => !new RegExp(`^\\s*${k}\\s*=`, 'm').test(props));
if (faltanProps.length) morir(`Faltan en ${gradleProps}:\n  ${faltanProps.join('\n  ')}`);

const ruta = props.match(/^\s*GYMUP_UPLOAD_STORE_FILE\s*=\s*(.+)$/m)?.[1].trim();

// Gradle lee gradle.properties como Java properties, donde `\` es un carácter
// de ESCAPE. Una ruta de Windows con barras invertidas
// (C:\Users\Juan\claves\gymup.jks) le llega a Gradle como
// "C:UsersJuanclavesgymup.jks". Node, en cambio, ve la cadena cruda,
// encuentra el archivo y daría el visto bueno — y el build moriría al final,
// después de toda la compilación, con un error que no menciona las barras.
if (ruta && ruta.includes('\\')) {
  morir(
    `GYMUP_UPLOAD_STORE_FILE lleva barras invertidas:\n  ${ruta}\n\n` +
      `  Gradle lee este archivo como Java properties, donde "\\" es un escape:\n` +
      `  la ruta le llegaría sin las barras y no encontraría la keystore.\n` +
      `  Escríbela con barras normales en ${gradleProps}:\n` +
      `  ${ruta.replace(/\\/g, '/')}`,
  );
}

// Que la propiedad exista no significa que el archivo .jks siga ahí: se mueve,
// se renombra, se borra al limpiar el disco.
if (ruta && !fs.existsSync(ruta)) {
  morir(
    `GYMUP_UPLOAD_STORE_FILE apunta a un archivo que no existe:\n  ${ruta}\n` +
      `  Si moviste la keystore, actualiza la ruta en ${gradleProps}.`,
  );
}
console.log('  ✔ keystore configurada y encontrada');

// ── 2. .env.local no puede contradecir a .env ──

paso('Comprobando las variables de entorno');

// La regla y su porqué están en scripts/envConsistencia.mjs, con tests.
// Se buscan TODOS los .env*.local, no solo .env.local: Expo también carga
// .env.production.local y .env.development.local, y con más prioridad aún.
const localesEnv = fs
  .readdirSync(raiz)
  .filter((n) => /^\.env(\..+)?\.local$/.test(n))
  .map((nombre) => ({ nombre, contenido: fs.readFileSync(path.join(raiz, nombre), 'utf8') }));

const veredictoEnv = revisarEnv(localesEnv);
if (!veredictoEnv.ok) morir(veredictoEnv.mensaje);
console.log(`  ✔ ${veredictoEnv.mensaje}`);

// ── 3. versionCode: el error que solo se ve al subir a Play ──

paso('Comprobando el versionCode');

const appJson = JSON.parse(fs.readFileSync(path.join(raiz, 'app.json'), 'utf8'));
const versionCode = appJson?.expo?.android?.versionCode;
const version = appJson?.expo?.version;
if (typeof versionCode !== 'number') {
  morir('app.json no define expo.android.versionCode, que en un build local es obligatorio.');
}
console.log(`  versión ${version} (versionCode ${versionCode})`);
console.log(
  '  \x1b[33m⚠ Google quema el versionCode en cuanto subes el archivo, aunque\n' +
    '    después descartes el borrador. Si este número ya se subió alguna vez,\n' +
    '    cancela ahora (Ctrl+C) y súbelo en app.json.\x1b[0m',
);

// ── 4. Lo que EAS corría en el servidor ──

paso('Verificando el proyecto (secretos, tipos, tests)');
correr('npm', ['run', 'verify']);

paso('Estado de las revisiones externas');
correr('node', ['scripts/check-release-readiness.mjs']);

// ── 5. Generar el proyecto nativo y compilar ──

paso('Generando el proyecto nativo');
// --clean borra android/ entera: es lo correcto, porque está en .gitignore y
// todo lo que necesita se reconstruye desde app.json y los config plugins.
//
// La plantilla va FIJADA a una versión exacta. Sin --template, Expo descarga
// `expo-template-bare-minimum@sdk-54`, y `sdk-54` es un dist-tag MUTABLE: hoy
// resuelve a 54.0.52 y mañana a otra. O sea que el mismo commit podría generar
// proyectos nativos distintos según el día — incluido el bloque de firma que
// plugins/withFirmaRelease.js localiza por expresión regular, y el snapshot de
// __tests__/firmaRelease.test.ts.
// Al subir de SDK hay que cambiar este número a mano, que es justo lo que se
// quiere: un cambio del proyecto nativo debe verse en un commit.
// prebuild reescribe los scripts de package.json ("expo start --android" pasa
// a "expo run:android") en CADA pasada. Es un efecto secundario suyo sobre un
// archivo versionado, así que cada build dejaría el repositorio sucio y
// tocaría acordarse de descartarlo antes de commitear.
const rutaPackage = path.join(raiz, 'package.json');
const packageAntes = fs.readFileSync(rutaPackage, 'utf8');

correr('npx', [
  'expo', 'prebuild', '--platform', 'android', '--clean',
  '--template', `expo-template-bare-minimum@${PLANTILLA_NATIVA}`,
]);

if (fs.readFileSync(rutaPackage, 'utf8') !== packageAntes) {
  fs.writeFileSync(rutaPackage, packageAntes);
  console.log('  (package.json restaurado: prebuild lo reescribe en cada pasada)');
}

paso('Compilando el AAB');
// Solo las dos arquitecturas ARM. x86 y x86_64 son para emuladores: ningún
// teléfono de la tienda las usa, y cada una multiplica la compilación de los
// cinco módulos C++ (vision-camera, fast-tflite, worklets, nitro, resize).
// Pasarlo por línea de comandos y no en gradle.properties es deliberado: así
// `expo run:android` sigue pudiendo compilar para un emulador.
// El AAB reparte por ABI, así que al usuario no le cambia nada.
// Ruta ABSOLUTA y entre comillas. Con `shell: true` en Windows, cmd resuelve
// el comando por PATH y no mira el directorio de trabajo, así que un
// "gradlew.bat" suelto falla con "no se reconoce como un comando" aunque el
// cwd sea el correcto y el archivo esté justo ahí.
const gradlew = path.join(raiz, 'android', esWindows ? 'gradlew.bat' : 'gradlew');
correr(`"${gradlew}"`, [
  'bundleRelease',
  '-PreactNativeArchitectures=armeabi-v7a,arm64-v8a',
], {
  cwd: path.join(raiz, 'android'),
  env: {
    ...process.env,
    // Estaba en las variables de entorno de EAS. Sin ella, el plugin de Sentry
    // intenta subir los source maps y no encuentra ni organización, ni proyecto,
    // ni token. Cuando configuremos el token de Sentry, esto se quita y los
    // source maps vuelven — hoy no los tenemos ni en EAS.
    SENTRY_DISABLE_AUTO_UPLOAD: 'true',
  },
});

// ── 6. Dónde quedó ──

const aab = path.join(raiz, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
if (!fs.existsSync(aab)) morir(`Gradle terminó bien pero no encuentro el AAB en:\n  ${aab}`);

const mb = (fs.statSync(aab).size / 1024 / 1024).toFixed(1);
console.log(`\n\x1b[32m✔ AAB listo\x1b[0m  (${mb} MB)\n  ${aab}`);
console.log(`\n  Súbelo a Play Console como versión ${version} (${versionCode}).`);
console.log('  Después, sube el versionCode en app.json para el siguiente build.\n');
