import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const patterns = [
  ['OpenAI key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ['GitHub classic token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g],
  ['Supabase personal token', /\bsbp_[A-Za-z0-9]{20,}\b/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const findings = [];
for (const file of files) {
  if (/^(?:node_modules|dist|\.expo)\//.test(file) || /\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|lock)$/i.test(file)) continue;
  let content;
  try { content = readFileSync(file, 'utf8'); } catch { continue; }
  for (const [name, regex] of patterns) {
    regex.lastIndex = 0;
    if (regex.test(content)) findings.push(`${file}: posible ${name}`);
  }
}
if (findings.length) {
  process.stderr.write(`Secretos potenciales detectados:\n${findings.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`Secret scan OK (${files.length} archivos rastreados)\n`);
