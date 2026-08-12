// scripts/envConsistencia.mjs
// ─────────────────────────────────────────────────────────
// Comparar `.env.local` contra `.env` antes de compilar en local.
//
// Expo carga los dos y `.env.local` GANA
// (node_modules/@expo/env/build/index.js: la lista va de mayor a menor
// prioridad y se aplica en orden inverso, sobrescribiendo clave a clave).
// `.env` está versionado; `.env.local` está en .gitignore, así que ningún
// build de EAS lo vio nunca. Al compilar en local pasa a mandar él.
//
// Esto vive en su propio módulo, y no dentro de build-android.mjs, porque un
// guardia que se equivoca es peor que no tener guardia: la primera versión
// partía por '\n' sin quitar el '\r' de los finales de línea de Windows, no
// reconocía NINGUNA clave, y daba el visto bueno anunciando "0 claves que
// comparten". Un guardia que no compara nada y dice que todo está bien es
// exactamente el fallo que venía a impedir. Por eso ahora se prueba.
// ─────────────────────────────────────────────────────────

/**
 * Lee un archivo .env a un objeto. Deliberadamente simple: estos archivos son
 * `CLAVE=valor` y nada más — sin `export`, sin valores multilínea.
 */
export function parseEnv(contenido) {
  const salida = {};
  // \r?\n: los archivos del repo tienen CRLF. Partir solo por '\n' deja un
  // '\r' al final de cada línea que, al ser terminador de línea para el motor
  // de expresiones regulares, impide que `$` case y descarta la línea entera.
  for (const linea of contenido.split(/\r?\n/)) {
    const sinComentario = linea.trim();
    if (!sinComentario || sinComentario.startsWith('#')) continue;

    const m = sinComentario.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;

    salida[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return salida;
}

/**
 * Veredicto para `npm run build:android`.
 *
 * `locales` es la lista de archivos `.env*.local` encontrados, como
 * `[{ nombre, contenido }]`. La lista vacía es el caso sano.
 *
 * La regla es dura a propósito: **cualquier `.env*.local` aborta el build**,
 * aunque sus valores coincidan hoy con los de `.env`. Un artefacto que va a
 * una tienda tiene que salir de lo que está en el repositorio y nada más. Un
 * archivo que no se versiona, que no aparece en ninguna revisión y que además
 * tiene PRIORIDAD sobre el versionado no puede decidir con qué credenciales
 * sale la app: el día que apunte a un Supabase de pruebas —que es justo para
 * lo que existe un `.env.local`— el build sale verde, Play lo acepta, y el
 * usuario que actualice se encuentra su historial vacío.
 *
 * Comparar valores y dejar pasar si coinciden fue el primer intento. Protege
 * del descuido, pero no del caso que de verdad hace daño, porque entonces los
 * valores SÍ son distintos... y también lo era el `.env` que nadie miró.
 */
export function revisarEnv(locales) {
  const lista = (locales ?? []).filter((f) => f && f.contenido !== null && f.contenido !== undefined);

  if (lista.length === 0) {
    return { ok: true, mensaje: 'sin archivos .env*.local: manda .env, el que está versionado' };
  }

  const detalle = lista
    .map((f) => {
      const claves = Object.keys(parseEnv(f.contenido));
      return `  ${f.nombre} (${claves.length} ${claves.length === 1 ? 'clave' : 'claves'})`;
    })
    .join('\n');

  return {
    ok: false,
    archivos: lista.map((f) => f.nombre),
    mensaje:
      `Hay archivos de entorno que NO están en el repositorio:\n${detalle}\n\n` +
      '  Expo les da prioridad sobre .env, así que el AAB saldría con SUS valores.\n' +
      '  Como no se versionan, nadie los vería en una revisión del código.\n\n' +
      '  Para un build de tienda, las variables tienen que venir del .env versionado.\n' +
      '  Muévelos fuera del proyecto (o renómbralos) y vuelve a lanzar el build.',
  };
}
