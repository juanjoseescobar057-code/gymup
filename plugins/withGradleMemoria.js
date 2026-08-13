// plugins/withGradleMemoria.js
// ─────────────────────────────────────────────────────────
// Memoria y paralelismo de Gradle, ajustados a una máquina de 4 núcleos.
//
// La plantilla de Expo genera `org.gradle.jvmargs=-Xmx2048m` con
// `org.gradle.parallel=true`. En una máquina con muchos núcleos va bien. Con
// cuatro, y compilando a la vez Metro (Node), el demonio de Kotlin y cinco
// módulos C++, Gradle no consigue arrancar sus procesos hijo dentro del plazo
// y el build muere con:
//
//     Failed to run Gradle Worker Daemon
//     Unable to connect to the child process 'Gradle Worker Daemon 5'
//     The connection attempt hit a timeout after 120,0 seconds
//
// El mensaje no dice "sin memoria" ni "sin CPU" —dice que el hijo no
// respondió— así que es fácil buscarlo por el sitio equivocado. Pasó de
// verdad, en el minuto 32 de una compilación de 45.
//
// Va en un config plugin y no editando android/gradle.properties porque esa
// carpeta la borra y regenera `expo prebuild --clean` en cada build.
// ─────────────────────────────────────────────────────────

const { withGradleProperties } = require('@expo/config-plugins');

const AJUSTES = [
  {
    key: 'org.gradle.jvmargs',
    // 2048m era poco para javac + Kotlin + el resto a la vez. 3g deja margen
    // sin invadir lo que necesitan Metro y el sistema: subirlo más en una
    // máquina de 16 GB provoca intercambio a disco, que es peor que ir justo.
    value: '-Xmx3072m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8',
    porque: 'el heap por defecto no da para javac + Kotlin + C++ a la vez',
  },
  {
    key: 'org.gradle.workers.max',
    // Con 4 núcleos, Gradle lanzaría hasta 4 procesos hijo, cada uno con su
    // propia JVM, mientras Metro ya tiene ocupado uno. Limitar a 2 hace el
    // build algo más lento en el papel y muchísimo más probable que termine.
    value: '2',
    porque: '4 núcleos no dan para 4 procesos hijo más Metro y Kotlin',
  },
  {
    key: 'kotlin.daemon.jvmargs',
    value: '-Xmx1536m',
    porque: 'el demonio de Kotlin arranca sin límite propio y compite por la RAM',
  },
  {
    key: 'org.gradle.caching',
    // Sin esto, las salidas compiladas solo viven en android/, y
    // `prebuild --clean` borra esa carpeta entera en cada build: se recompila
    // lo mismo una y otra vez. Con la caché activada van a ~/.gradle y se
    // reutilizan aunque android/ se regenere.
    value: 'true',
    porque: 'prebuild --clean borra android/ y sin caché se recompila todo cada vez',
  },
];

function ponerPropiedad(items, key, value) {
  const existente = items.find((i) => i.type === 'property' && i.key === key);
  if (existente) {
    existente.value = value;
    return items;
  }
  return [...items, { type: 'property', key, value }];
}

module.exports = function withGradleMemoria(config) {
  return withGradleProperties(config, (cfg) => {
    for (const { key, value } of AJUSTES) {
      cfg.modResults = ponerPropiedad(cfg.modResults, key, value);
    }
    return cfg;
  });
};

module.exports.AJUSTES = AJUSTES;
module.exports.ponerPropiedad = ponerPropiedad;
