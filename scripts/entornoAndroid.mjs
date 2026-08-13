// scripts/entornoAndroid.mjs
// ─────────────────────────────────────────────────────────
// ¿Tiene esta máquina lo que hace falta para compilar el AAB?
//
// Sin esto, `npm run build:android` gastaba los 250 tests y el prebuild entero
// antes de que Gradle descubriera que falta el NDK, y el error que da entonces
// no dice qué versión instalar.
//
// Las versiones NO se escriben a mano aquí: se leen del catálogo de React
// Native (node_modules/react-native/gradle/libs.versions.toml), que es la
// misma fuente que usa Gradle. Cuando se suba de versión de Expo o RN, esta
// comprobación se actualiza sola en vez de quedarse pidiendo un NDK viejo.
// ─────────────────────────────────────────────────────────

/**
 * Saca compileSdk, buildTools y ndkVersion del catálogo de React Native.
 * Devuelve null si el archivo no tiene la forma esperada: quien llama debe
 * tratarlo como error, no como "no hace falta comprobar nada".
 */
export function versionesRequeridas(toml) {
  const buscar = (clave) => toml.match(new RegExp(`^\\s*${clave}\\s*=\\s*"([^"]+)"`, 'm'))?.[1];

  const compileSdk = buscar('compileSdk');
  const buildTools = buscar('buildTools');
  const ndkVersion = buscar('ndkVersion');

  if (!compileSdk || !buildTools || !ndkVersion) return null;
  return { compileSdk, buildTools, ndkVersion };
}

/**
 * Compara lo instalado contra lo exigido.
 *
 * `instalado` lleva los nombres de carpeta tal cual están en el SDK:
 * platforms ['android-36'], ndk ['27.1.12297006'], etc.
 *
 * La plataforma se compara EXACTA a propósito. Tener android-37 no sirve para
 * un proyecto que pide compileSdk 36: son paquetes distintos, no una versión
 * "más nueva" que valga igual, y Gradle falla pidiendo la 36 concreta.
 */
export function revisarSdk(requeridas, instalado) {
  const faltan = [];

  const plataforma = `android-${requeridas.compileSdk}`;
  if (!instalado.platforms?.includes(plataforma)) {
    faltan.push({
      que: `Android SDK Platform ${requeridas.compileSdk}`,
      detalle: `falta ${plataforma}` +
        (instalado.platforms?.length ? ` (instaladas: ${instalado.platforms.join(', ')})` : ' (no hay ninguna)'),
    });
  }

  if (!instalado.buildTools?.includes(requeridas.buildTools)) {
    faltan.push({ que: `SDK Build-Tools ${requeridas.buildTools}`, detalle: 'falta la versión exacta' });
  }

  if (!instalado.platformTools) {
    faltan.push({ que: 'SDK Platform-Tools', detalle: 'falta' });
  }

  if (!instalado.ndk?.includes(requeridas.ndkVersion)) {
    faltan.push({
      que: `NDK (Side by side) ${requeridas.ndkVersion}`,
      detalle: 'lo necesitan vision-camera, fast-tflite, worklets, nitro y resize-plugin, que compilan C++',
    });
  }

  if (!instalado.cmake?.length) {
    faltan.push({ que: 'CMake', detalle: 'es lo que dispara la compilación de esos módulos C++' });
  }

  return faltan;
}

/**
 * Un espacio en la ruta del SDK rompe la compilación de C++ en Windows, y lo
 * hace de una forma que no se parece en nada a su causa.
 *
 * CMake, para no pelearse con las comillas, invoca al compilador por su nombre
 * corto 8.3 cuando la ruta lleva espacios. Y `clang++.exe` en 8.3 es
 * `CLANG_~1.EXE`: pierde los `++`. Clang decide si actúa como compilador de C
 * o de C++ POR EL NOMBRE con el que lo llaman, así que enlaza en modo C y no
 * añade la biblioteca estándar de C++.
 *
 * El resultado son cientos de `undefined symbol: operator new`,
 * `__cxa_throw`, `std::__ndk1::...` al enlazar — que parecen un problema de
 * la librería que estés compilando, no de dónde está instalado el SDK.
 *
 * Comprobado en esta máquina: invocando `clang++.exe` por su ruta larga
 * enlaza; por la corta falla con 16 símbolos indefinidos. En Linux (EAS) no
 * pasa porque no hay nombres 8.3.
 *
 * Aparece al final de la compilación, cuando ya se han gastado 30 minutos.
 */
export function rutaConEspacios(androidHome) {
  if (!androidHome.includes(' ')) return null;
  return (
    `El SDK de Android está en una ruta con espacios:\n  ${androidHome}\n\n` +
    `  En Windows eso rompe la compilación de C++: CMake invoca al compilador\n` +
    `  por su nombre corto 8.3, y "clang++.exe" se convierte en "CLANG_~1.EXE".\n` +
    `  Al perder los "++", clang enlaza como si fuera C y deja fuera la\n` +
    `  biblioteca estándar de C++. El build muere al final con cientos de\n` +
    `  "undefined symbol: operator new", "__cxa_throw"...\n\n` +
    `  Mueve el SDK a una ruta sin espacios y apunta ANDROID_HOME ahí:\n\n` +
    `    Move-Item "${androidHome}" "C:\\Android\\Sdk"\n` +
    `    [Environment]::SetEnvironmentVariable('ANDROID_HOME', 'C:\\Android\\Sdk', 'User')\n\n` +
    `  Después abre una terminal nueva. Ver docs/BUILD_LOCAL.md.`
  );
}

/** Mensaje único, con el sitio donde se instala todo esto. */
export function mensajeFaltantes(faltan) {
  return (
    `Al SDK de Android le faltan piezas que este proyecto necesita:\n\n` +
    faltan.map((f) => `  • ${f.que}\n      ${f.detalle}`).join('\n') +
    `\n\n  Se instalan desde Android Studio:\n` +
    `  More Actions → SDK Manager → pestaña "SDK Tools"\n` +
    `  (marca "Show Package Details" para elegir la versión exacta del NDK).\n` +
    `  La plataforma está en la pestaña "SDK Platforms".`
  );
}
