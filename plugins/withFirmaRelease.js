// plugins/withFirmaRelease.js
// ─────────────────────────────────────────────────────────
// Firma del AAB de release al compilar en local.
//
// La plantilla de Expo (expo-template-bare-minimum) genera esto:
//
//     release {
//         // Caution! In production, you need to generate your own keystore file.
//         signingConfig signingConfigs.debug
//     }
//
// O sea que `./gradlew bundleRelease` produce un AAB firmado con la keystore de
// DEPURACIÓN. Se instala y arranca sin quejarse, así que es fácil no darse
// cuenta hasta que Google Play rechaza la subida por certificado incorrecto.
//
// Esto no se puede arreglar editando android/app/build.gradle a mano: esa
// carpeta está en .gitignore y `expo prebuild --clean` la borra y la regenera
// entera cada vez. Por eso va aquí, en un config plugin, que es parte del
// proyecto y se vuelve a aplicar en cada prebuild.
//
// Las contraseñas NO están aquí ni en ningún archivo del repo: se leen de
// ~/.gradle/gradle.properties, que vive fuera del proyecto.
// Ver docs/BUILD_LOCAL.md.
// ─────────────────────────────────────────────────────────

const { withAppBuildGradle } = require('@expo/config-plugins');

/** Si esta propiedad no está definida, no hay keystore de subida configurada. */
const PROP_ARCHIVO = 'GYMUP_UPLOAD_STORE_FILE';

const BLOQUE_SIGNING = `
        release {
            // Credenciales desde ~/.gradle/gradle.properties (fuera del repo).
            if (project.hasProperty('${PROP_ARCHIVO}')) {
                storeFile file(${PROP_ARCHIVO})
                storePassword GYMUP_UPLOAD_STORE_PASSWORD
                keyAlias GYMUP_UPLOAD_KEY_ALIAS
                keyPassword GYMUP_UPLOAD_KEY_PASSWORD
            } else if (gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }) {
                // Fallar aquí y en voz alta. La alternativa es un AAB firmado
                // con la clave de depuración, que Play rechaza después de
                // haberte hecho esperar toda la compilación y la subida.
                throw new GradleException(
                    "Falta ${PROP_ARCHIVO} en ~/.gradle/gradle.properties.\\n" +
                    "Sin la keystore de subida el AAB se firmaría con la clave de depuración y Play lo rechazaría.\\n" +
                    "Ver docs/BUILD_LOCAL.md, apartado 'Configurar la firma fuera del repo'."
                )
            }
        }`;

/**
 * Anclas sobre el texto que genera la plantilla. Si alguna deja de encontrarse
 * —porque Expo cambió la plantilla en una versión futura— el plugin LANZA en
 * vez de seguir. Un plugin que falla en silencio aquí devuelve exactamente el
 * problema que vino a resolver, y sin avisar.
 */
const ANCLA_SIGNING_CONFIGS = /signingConfigs \{/;
const ANCLA_RELEASE_DEBUG = /(release \{[^}]*?\/\/ Caution![\s\S]*?\n)(\s*)signingConfig signingConfigs\.debug/;

const YA_APLICADO = /signingConfig signingConfigs\.release/;

function inyectarFirma(gradle) {
  if (YA_APLICADO.test(gradle)) return gradle;

  if (!ANCLA_SIGNING_CONFIGS.test(gradle)) {
    throw new Error(
      '[withFirmaRelease] No encontré el bloque `signingConfigs {` en android/app/build.gradle. ' +
        'La plantilla de Expo cambió: revisa el plugin antes de compilar, o el AAB saldrá mal firmado.',
    );
  }
  if (!ANCLA_RELEASE_DEBUG.test(gradle)) {
    throw new Error(
      '[withFirmaRelease] No encontré `signingConfig signingConfigs.debug` dentro del buildType release. ' +
        'La plantilla de Expo cambió: revisa el plugin antes de compilar, o el AAB saldrá mal firmado.',
    );
  }

  return gradle
    .replace(ANCLA_SIGNING_CONFIGS, `signingConfigs {${BLOQUE_SIGNING}`)
    .replace(
      ANCLA_RELEASE_DEBUG,
      (_m, cabecera, sangria) =>
        `${cabecera}${sangria}// Firmado con la keystore de subida real. Ver plugins/withFirmaRelease.js\n` +
        `${sangria}signingConfig signingConfigs.release`,
    );
}

module.exports = function withFirmaRelease(config) {
  // En EAS Build no tocamos nada: EAS inyecta su propia configuración de firma
  // con la keystore que guarda en sus servidores. Si además la pusiéramos
  // nosotros, EAS no encontraría el texto que espera modificar y el build
  // remoto se rompería. Este plugin es SOLO para compilar en local.
  if (process.env.EAS_BUILD) return config;

  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        `[withFirmaRelease] Esperaba build.gradle en Groovy y llegó ${cfg.modResults.language}.`,
      );
    }
    cfg.modResults.contents = inyectarFirma(cfg.modResults.contents);
    return cfg;
  });
};

// Exportado aparte para poder probar la transformación sin correr un prebuild.
module.exports.inyectarFirma = inyectarFirma;
