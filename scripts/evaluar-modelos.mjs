// scripts/evaluar-modelos.mjs
// ─────────────────────────────────────────────────────────
// Compara gpt-4o contra gpt-4o-mini en los prompts REALES de la app.
//
// POR QUÉ EXISTE
// Casi todas las funciones corren en gpt-4o, que cuesta dieciséis veces más que
// mini ($2.50/$10 por millón de tokens frente a $0.15/$0.60). Bajar las tres de
// visión a mini es lo que hace que los cupos que anuncia el paywall quepan en el
// presupuesto mensual. Pero cambiar de modelo a ciegas en una app que da
// consejos de técnica y estima macros es cambiar la calidad del producto sin
// mirar, y eso no se hace con una hoja de cálculo.
//
// Esto manda el MISMO payload a los dos modelos y enseña las dos respuestas una
// al lado de la otra, con sus tokens y su costo medido.
//
// CÓMO SE USA
//   $env:OPENAI_API_KEY = "sk-..."      (en PowerShell; NUNCA en el repo)
//   node scripts/evaluar-modelos.mjs --foto-postura C:\ruta\sentadilla.jpg ^
//                                    --foto-comida  C:\ruta\plato.jpg ^
//                                    --foto-nevera  C:\ruta\nevera.jpg
//
// Cada foto es opcional: se evalúa lo que se le dé. El informe queda en
// docs/evaluacion-modelos.md.
//
// EL PROMPT NO SE COPIA AQUÍ. Se extrae del código en cada ejecución, para que
// no pueda quedarse viejo: comparar dos modelos con un prompt que ya no es el
// que usa la app no compara nada.
// ─────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';

const raiz = process.cwd();

const PRECIOS = {
  'gpt-4o': { entrada: 2.5, salida: 10 },
  'gpt-4o-mini': { entrada: 0.15, salida: 0.6 },
};

/** Las tres funciones que están en juego, con dónde vive su prompt. */
const FUNCIONES = [
  {
    clave: 'postura',
    titulo: 'Análisis de técnica',
    archivo: path.join('app', '(tabs)', 'coach.tsx'),
    // Fragmento que identifica el prompt dentro del archivo.
    // Con comillas: sin ellas el ancla coincide primero con el TIPO de
    // TypeScript que está 60 líneas más arriba, y se extraería el archivo entero
    // desde el principio en vez del prompt. Pasó al escribir esto.
    ancla: '"is_exercise_visible"',
    detalle: 'high',
    maxTokens: 1000,
    riesgo: 'Corrige técnica a partir de una foto. Un mal consejo puede acabar en lesión.',
  },
  {
    clave: 'comida',
    titulo: 'Escaneo de comida',
    archivo: path.join('lib', 'openai.ts'),
    ancla: 'Nutricionista experto',
    detalle: 'high',
    maxTokens: 500,
    riesgo: 'Estima macros. El riesgo es de precisión del dato, no de seguridad.',
  },
  {
    clave: 'nevera',
    titulo: 'Escaneo de nevera',
    archivo: path.join('lib', 'openai-features.ts'),
    ancla: '"quality_message"',
    detalle: 'high',
    maxTokens: 2000,
    riesgo: 'Sugiere recetas con lo que hay. Si acierta menos, se nota poco.',
  },
];

/** Valores de ejemplo para las interpolaciones del prompt. */
const EJEMPLO = {
  age: 30,
  weight_kg: 78,
  height_cm: 176,
  goal: 'ganar masa muscular',
  daily_calories: 2400,
  daily_protein_g: 150,
  exercise: 'Sentadilla',
};

/**
 * Saca el prompt de texto del archivo fuente.
 *
 * Busca el template literal que contiene el ancla y sustituye cada `${...}` por
 * un valor de ejemplo. La ESTRUCTURA del prompt —que es lo que decide si un
 * modelo lo entiende— queda intacta.
 */
function extraerPrompt(archivo, ancla) {
  const fuente = fs.readFileSync(path.join(raiz, archivo), 'utf8');
  const i = fuente.indexOf(ancla);
  if (i < 0) throw new Error(`no encontré "${ancla}" en ${archivo}`);

  // El prompt siempre se pasa como `text: \`...\``, y esa marca aparece UNA sola
  // vez por archivo. Retroceder hasta el backtick más cercano no valía: el
  // prompt de técnica lleva un ternario con su propio template dentro
  // (`${cond ? \`...\` : ''}`), así que el retroceso caía en el backtick anidado
  // y se perdían las primeras líneas — justo las que dicen qué se está mirando.
  const MARCA = 'text: `';
  const marca = fuente.lastIndexOf(MARCA, i);
  if (marca < 0) throw new Error(`no encontré "${MARCA}" antes del ancla en ${archivo}`);
  const inicio = marca + MARCA.length - 1;

  // Hacia delante hasta el backtick que cierra el template EXTERIOR, saltando
  // los anidados: cada `${` abre un nivel y su `}` lo cierra.
  let fin = inicio + 1;
  let nivel = 0;
  while (fin < fuente.length) {
    const c = fuente[fin];
    if (c === '\\') { fin += 2; continue; }
    if (c === '$' && fuente[fin + 1] === '{') { nivel++; fin += 2; continue; }
    if (c === '}' && nivel > 0) { nivel--; fin++; continue; }
    if (c === '`' && nivel === 0) break;
    fin++;
  }
  if (fin >= fuente.length) throw new Error(`template sin cerrar en ${archivo}`);
  const crudo = fuente.slice(inicio + 1, fin);

  return crudo.replace(/\$\{([^}]*)\}/g, (_, expr) => {
    const limpia = expr.trim();
    for (const [clave, valor] of Object.entries(EJEMPLO)) {
      if (limpia.includes(clave)) return String(valor);
    }
    return '[dato del usuario]';
  });
}

function costo(modelo, entrada, salida) {
  const p = PRECIOS[modelo];
  return (entrada * p.entrada + salida * p.salida) / 1_000_000;
}

async function llamar(modelo, prompt, base64, detalle, maxTokens, apiKey) {
  const content = [];
  if (base64) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${base64}`, detail: detalle },
    });
  }
  content.push({ type: 'text', text: prompt });

  const inicio = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelo,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
      max_tokens: maxTokens,
    }),
  });
  const ms = Date.now() - inicio;
  const cuerpo = await res.json();

  if (!res.ok) {
    return { error: cuerpo?.error?.message ?? `HTTP ${res.status}`, ms };
  }
  const uso = cuerpo.usage ?? {};
  const texto = cuerpo.choices?.[0]?.message?.content ?? '';
  let json = null;
  let jsonValido = false;
  try {
    json = JSON.parse(texto);
    jsonValido = true;
  } catch { /* se reporta como inválido */ }

  return {
    texto,
    json,
    jsonValido,
    entrada: uso.prompt_tokens ?? 0,
    salida: uso.completion_tokens ?? 0,
    costo: costo(modelo, uso.prompt_tokens ?? 0, uso.completion_tokens ?? 0),
    ms,
  };
}

/** Los campos que devolvió cada modelo, para ver si alguno se deja alguno. */
function camposDe(json) {
  if (!json || typeof json !== 'object') return [];
  return Object.keys(json).sort();
}

function args() {
  const out = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!arg.startsWith('--')) continue;
    const clave = arg.slice(2);
    const siguiente = process.argv[i + 1];
    // Una bandera sin valor (--solo-prompts) queda en true. Leer a pares ciegas
    // hacía que se comiera el argumento siguiente y que la bandera valiera
    // undefined, así que nunca se activaba.
    if (siguiente && !siguiente.startsWith('--')) {
      out[clave] = siguiente;
      i++;
    } else {
      out[clave] = true;
    }
  }
  return out;
}

async function main() {
  const a = args();

  // Prueba en seco: enseña qué prompt se extrajo de cada archivo y termina, sin
  // llamar a OpenAI ni gastar un céntimo. Sirve para comprobar que las anclas
  // siguen apuntando al prompt y no a otra cosa — al escribir esto, dos de las
  // tres coincidían primero con el TIPO de TypeScript de más arriba y extraían
  // el archivo entero desde el principio.
  if (a['solo-prompts'] !== undefined) {
    for (const f of FUNCIONES) {
      try {
        const prompt = extraerPrompt(f.archivo, f.ancla);
        const interpolaciones = (fs.readFileSync(path.join(raiz, f.archivo), 'utf8')
          .slice(0, 0) || '');
        console.log(`
── ${f.titulo} · ${f.archivo} ──`);
        console.log(`   ${prompt.length} caracteres`);
        console.log(`   empieza: ${JSON.stringify(prompt.slice(0, 90))}`);
        console.log(`   termina: ${JSON.stringify(prompt.slice(-70))}`);
        if (/^import |^const |^export /m.test(prompt.slice(0, 200))) {
          console.log('   ⚠️  Esto parece código, no un prompt: revisa el ancla.');
        }
        void interpolaciones;
      } catch (e) {
        console.log(`
── ${f.titulo} ──
   FALLA: ${e.message}`);
      }
    }
    console.log('');
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Falta OPENAI_API_KEY en el entorno.');
    console.error('  PowerShell:  $env:OPENAI_API_KEY = "sk-..."');
    console.error('No la pongas en ningún archivo del repo.');
    process.exit(1);
  }

  const fotos = {
    postura: a['foto-postura'],
    comida: a['foto-comida'],
    nevera: a['foto-nevera'],
  };

  const conFoto = FUNCIONES.filter((f) => fotos[f.clave]);
  if (conFoto.length === 0) {
    console.error('No diste ninguna foto. Ejemplo:');
    console.error('  node scripts/evaluar-modelos.mjs --foto-comida C:\\fotos\\plato.jpg');
    process.exit(1);
  }

  const informe = [
    '# gpt-4o contra gpt-4o-mini, con los prompts reales',
    '',
    'Generado por `scripts/evaluar-modelos.mjs`. Los prompts se extraen del código',
    'en cada ejecución, así que son exactamente los que usa la app.',
    '',
    '> El plan de entrenamiento y el análisis corporal NO se evalúan aquí: se',
    '> quedan en gpt-4o pase lo que pase. El plan decide qué se le programa a',
    '> alguien con una hernia.',
    '',
  ];

  let ahorroMes = 0;

  for (const f of conFoto) {
    const ruta = fotos[f.clave];
    if (!fs.existsSync(ruta)) {
      console.error(`No existe la foto de ${f.clave}: ${ruta}`);
      continue;
    }
    const base64 = fs.readFileSync(ruta).toString('base64');
    const prompt = extraerPrompt(f.archivo, f.ancla);

    console.log(`\n── ${f.titulo} ──`);
    console.log(`   prompt: ${prompt.length} caracteres, extraído de ${f.archivo}`);

    const resultados = {};
    for (const modelo of ['gpt-4o', 'gpt-4o-mini']) {
      process.stdout.write(`   ${modelo}... `);
      resultados[modelo] = await llamar(modelo, prompt, base64, f.detalle, f.maxTokens, apiKey);
      const r = resultados[modelo];
      console.log(r.error ? `ERROR: ${r.error}` : `$${r.costo.toFixed(5)} · ${r.ms} ms`);
    }

    const grande = resultados['gpt-4o'];
    const chico = resultados['gpt-4o-mini'];

    informe.push(`## ${f.titulo}`, '');
    informe.push(`**Riesgo si baja la calidad:** ${f.riesgo}`, '');
    informe.push(`Foto: \`${path.basename(ruta)}\` · prompt de ${prompt.length} caracteres`, '');

    if (grande.error || chico.error) {
      informe.push(`⚠️ Falló una llamada: ${grande.error ?? chico.error}`, '');
      continue;
    }

    const veces = chico.costo > 0 ? grande.costo / chico.costo : 0;
    informe.push('| | gpt-4o | gpt-4o-mini |');
    informe.push('|---|---|---|');
    informe.push(`| Costo | $${grande.costo.toFixed(5)} | $${chico.costo.toFixed(5)} |`);
    informe.push(`| Tokens entrada | ${grande.entrada} | ${chico.entrada} |`);
    informe.push(`| Tokens salida | ${grande.salida} | ${chico.salida} |`);
    informe.push(`| Tiempo | ${grande.ms} ms | ${chico.ms} ms |`);
    informe.push(`| JSON válido | ${grande.jsonValido ? 'sí' : 'NO'} | ${chico.jsonValido ? 'sí' : 'NO'} |`);
    informe.push('');
    informe.push(`mini sale **${veces.toFixed(1)}× más barato** en esta llamada.`, '');

    const camposGrande = camposDe(grande.json);
    const camposChico = camposDe(chico.json);
    const faltan = camposGrande.filter((c) => !camposChico.includes(c));
    if (faltan.length > 0) {
      informe.push(`⚠️ **mini se dejó campos que gpt-4o sí devolvió:** ${faltan.join(', ')}`, '');
    } else if (camposGrande.length > 0) {
      informe.push('Los dos devolvieron los mismos campos.', '');
    }

    informe.push('<details><summary>Respuesta de gpt-4o</summary>', '');
    informe.push('```json', grande.texto.trim(), '```', '</details>', '');
    informe.push('<details><summary>Respuesta de gpt-4o-mini</summary>', '');
    informe.push('```json', chico.texto.trim(), '```', '</details>', '');

    // Ahorro mensual con el cupo que anuncia el paywall.
    const CUPOS = { postura: 10, comida: 4, nevera: 1 };
    ahorroMes += (grande.costo - chico.costo) * (CUPOS[f.clave] ?? 1) * 30;
  }

  informe.push('## Qué decide esto', '');
  informe.push(
    `Con los cupos que anuncia el paywall, mover estas funciones a mini ahorra ` +
      `**$${ahorroMes.toFixed(2)} al mes** por usuario Premium que las agote.`,
    '',
  );
  informe.push(
    'Lo que hay que mirar antes de cambiar no es el costo: es si las respuestas de',
    'mini siguen sirviendo. En concreto —',
    '',
    '- **Técnica:** ¿detecta los mismos fallos de postura? ¿inventa correcciones?',
    '- **Comida:** ¿los macros se parecen? ¿reconoce los mismos ingredientes?',
    '- **Nevera:** ¿las recetas son cocinables con lo que de verdad se ve?',
    '',
    'Si mini falla en técnica, esa se queda en gpt-4o y baja su cupo. Las otras dos',
    'son de precisión, no de seguridad.',
    '',
  );

  const salida = path.join(raiz, 'docs', 'evaluacion-modelos.md');
  fs.writeFileSync(salida, informe.join('\n'));
  console.log(`\nInforme escrito en ${path.relative(raiz, salida)}`);
  console.log(`Ahorro estimado si se cambian todas: $${ahorroMes.toFixed(2)}/mes por usuario al tope.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
