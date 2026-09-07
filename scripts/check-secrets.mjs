import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Cada patrón es de un secreto que, filtrado, le cuesta dinero o control a
// alguien. Las claves PÚBLICAS por diseño (anon key de Supabase, phc_ de
// PostHog, goog_/appl_ de RevenueCat, DSN de Sentry) NO van aquí: viajan
// dentro del APK y avisar de ellas solo enseñaría a ignorar este informe.
const patterns = [
  ['OpenAI key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ['GitHub classic token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g],
  ['Supabase personal token', /\bsbp_[A-Za-z0-9]{20,}\b/g],
  // Faltaba, y es justo el que se le pide a alguien que ponga a mano para que
  // los errores de producción lleguen legibles.
  ['Sentry auth token', /\bsntrys?_[A-Za-z0-9_=+/-]{20,}\b/g],
  // La secret key de RevenueCat manda en toda la cuenta. La pública es goog_
  // o appl_, así que exigir sk_ no genera falsos positivos.
  ['RevenueCat secret key', /\bsk_[A-Za-z0-9]{20,}\b/g],
  // El service_role de Supabase es un JWT que se salta TODAS las políticas RLS.
  ['Supabase service_role key', /"role"\s*:\s*"service_role"/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];

const RUIDO = /^(?:node_modules|dist|\.expo|android|ios|\.git)\//;
const BINARIO = /\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|lock|aab|apk|keystore|jks|zip)$/i;

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);

function revisar(file) {
  if (RUIDO.test(file) || BINARIO.test(file)) return [];
  let content;
  try { content = readFileSync(file, 'utf8'); } catch { return []; }
  const hallados = [];
  for (const [name, regex] of patterns) {
    regex.lastIndex = 0;
    if (regex.test(content)) hallados.push(name);
  }
  return hallados;
}

// ── Lo rastreado: BLOQUEA ──
// Un secreto aquí ya está —o estará en el próximo push— en GitHub.
const rastreados = git(['ls-files', '-z']);
const graves = [];
for (const file of rastreados) {
  for (const name of revisar(file)) graves.push(`${file}: posible ${name}`);
}

// ── Lo que existe pero no se versiona: AVISA ──
//
// El escáner solo miraba `git ls-files`, así que era estructuralmente incapaz
// de ver un volcado de conversación ignorado con una clave de OpenAI repetida
// siete veces. No puede llegar a GitHub, y por eso no bloquea; pero está en el
// disco, entra en las copias de seguridad y se comparte por accidente, así que
// tiene que verse.
let avisos = [];
try {
  const sueltos = [
    ...git(['ls-files', '-z', '--others', '--exclude-standard']),
    ...git(['ls-files', '-z', '--others', '--ignored', '--exclude-standard']),
  ];
  for (const file of sueltos) {
    for (const name of revisar(file)) avisos.push(`${file}: posible ${name}`);
  }
} catch {
  // Sin repositorio git no hay nada que comparar; el bloque de arriba manda.
}
avisos = [...new Set(avisos)];

if (avisos.length) {
  process.stderr.write(
    `\nAVISO — secretos en archivos que NO se versionan (no llegan a GitHub, pero están en tu disco):\n` +
      avisos.map((a) => `  ${a}`).join('\n') +
      `\n  Rótalos y borra el archivo si ya no lo necesitas.\n\n`,
  );
}

if (graves.length) {
  process.stderr.write(`Secretos potenciales en archivos RASTREADOS:\n${graves.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(
  `Secret scan OK (${rastreados.length} archivos rastreados` +
    (avisos.length ? `, ${avisos.length} aviso(s) fuera del control de versiones` : '') +
    ')\n',
);
