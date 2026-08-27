// plugins/withArquitecturas.js
// ─────────────────────────────────────────────────────────
// Compilar solo las arquitecturas de teléfonos reales.
//
// La plantilla de Expo genera:
//
//     reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64
//
// Y el C++ de React Native se compila UNA VEZ POR ARQUITECTURA. Esa parte es
// la más lenta de todo el build con diferencia: en una compilación medida de
// 1h 28m, la mitad del tiempo se fue ahí — y la mitad de esa mitad, en x86 y
// x86_64, que solo usan los emuladores y algún Chromebook.
//
// Ningún teléfono Android vendido usa x86. Un AAB con armeabi-v7a y arm64-v8a
// cubre el catálogo de dispositivos reales, y Play acepta la subida igual:
// simplemente no ofrecerá la app a esas dos ABIs.
//
// Lo que se pierde, dicho claro: emuladores x86 (los de desarrollo, que aquí
// no se usan porque se prueba en un teléfono físico) y los Chromebooks con
// Android sobre Intel. Si algún día eso importa, se quita este plugin.
//
// Va en un config plugin y no editando android/gradle.properties porque esa
// carpeta la borra y la regenera `expo prebuild --clean` en cada build — el
// mismo motivo que withGradleMemoria y withFirmaRelease.
// ─────────────────────────────────────────────────────────

const { withGradleProperties } = require('@expo/config-plugins');

const CLAVE = 'reactNativeArchitectures';
const VALOR = 'armeabi-v7a,arm64-v8a';

module.exports = function withArquitecturas(config) {
  return withGradleProperties(config, (cfg) => {
    // Se SUSTITUYE la que genera la plantilla, no se añade otra: dos entradas
    // con la misma clave dejan ganar a la última y eso depende del orden en
    // que se apliquen los plugins, que no es algo sobre lo que valga la pena
    // apostar.
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === 'property' && item.key === CLAVE)
    );
    cfg.modResults.push({
      type: 'property',
      key: CLAVE,
      value: VALOR,
    });
    return cfg;
  });
};
