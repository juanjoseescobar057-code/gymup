// __tests__/losCuatroAjustes.test.ts
// ─────────────────────────────────────────────────────────
// Los cuatro cambios decididos antes del build 24.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leerCodigo = (...p: string[]) =>
  fs
    .readFileSync(path.join(process.cwd(), ...p), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// ── 1. El saludo diario, en mini ──

test('el saludo proactivo usa gpt-4o-mini', () => {
  // $0,0085 medidos contra ~$0,0005. Corre solo, cada día, para todos.
  const chat = leerCodigo('lib', 'coachChat.ts');
  const i = chat.indexOf('export async function getProactiveInsight');
  assert.ok(i > 0, 'no encontré getProactiveInsight');
  const cuerpo = chat.slice(i, i + 900);
  assert.match(cuerpo, /model: 'gpt-4o-mini'/, 'el saludo sigue en el modelo caro');
});

test('el chat del coach se queda en gpt-4o', () => {
  // Decisión explícita: la conversación sí razona sobre lo que se le pregunta.
  const chat = leerCodigo('lib', 'coachChat.ts');
  const i = chat.indexOf('export async function askCoach');
  assert.ok(i > 0, 'no encontré askCoach');
  assert.match(chat.slice(i, i + 900), /model: 'gpt-4o'/);
});

// ── 2. El tope del plan ──

test('Premium puede ajustar su plan más de una vez al día', () => {
  const pol = leerCodigo('supabase', 'functions', '_shared', 'politica.ts');
  const m = pol.match(/plan:\s*\{[^}]*premiumLimit:\s*(\d+)/);
  assert.ok(m, 'no encontré la política de plan');
  assert.ok(Number(m![1]) > 1, `premiumLimit sigue en ${m![1]}`);
});

test('gratis y prueba se quedan en 1', () => {
  // Ahí el plan es costo de adquisición y no hay ingreso que lo respalde.
  const pol = leerCodigo('supabase', 'functions', '_shared', 'politica.ts');
  const m = pol.match(/plan:\s*\{[^}]*freeLimit:\s*(\d+),\s*trialLimit:\s*(\d+)/);
  assert.ok(m, 'no encontré los topes');
  assert.equal(m![1], '1');
  assert.equal(m![2], '1');
});

// ── 3. El botón que nadie entendía ──

test('el botón del plan dice qué hace, no con qué está hecho', () => {
  const perfil = leerCodigo('app', '(tabs)', 'profile.tsx');
  assert.ok(
    !/Ajustar mi plan con IA/.test(perfil),
    'sigue el rótulo que describe la tecnología en vez del efecto',
  );
  assert.ok(
    !/Adapta cargas según tu desempeño real</.test(perfil),
    'sigue la descripción que no dice qué va a pasar',
  );
  // Lo que más frenaba: no saber si aplica algo de golpe.
  assert.match(perfil, /Te enseña qué cambia antes de aplicar nada/);
});

// ── 4. El historial de análisis corporales ──

test('la pantalla de historial existe y la abre alguien', () => {
  // Una pantalla que no abre nadie es el fallo que este repositorio ya cometió
  // con el reconsentimiento y con la hoja de iniciar sesión.
  assert.ok(
    fs.existsSync(path.join(process.cwd(), 'app', 'body-scan-historial.tsx')),
    'no existe la pantalla',
  );
  const layout = leerCodigo('app', '_layout.tsx');
  assert.match(layout, /name="body-scan-historial"/, 'la ruta no está registrada');

  const puertas = ['app/(tabs)/profile.tsx', 'app/body-scan.tsx'].filter((f) =>
    leerCodigo(...f.split('/')).includes("'/body-scan-historial'")
  );
  assert.ok(puertas.length >= 2, `solo ${puertas.length} pantalla(s) abren el historial`);
});

test('el historial está detrás de la compuerta del modo recuperación', () => {
  // Es "~X% de grasa" con un puntaje al lado: exactamente lo que ese modo
  // retira. Y el scheme "gymup" abre esta ruta por enlace directo.
  const hist = leerCodigo('app', 'body-scan-historial.tsx');
  assert.match(hist, /<GuardiaRecuperacion area="cuerpo"/);
  assert.match(hist, /<GuardiaFlag clave="body_scan"/);
});

test('el historial no promete fotos que no existen', () => {
  // Las fotos no se guardan, a propósito. Un historial que no lo diga deja a
  // la gente buscando algo que no está.
  const hist = leerCodigo('app', 'body-scan-historial.tsx');
  assert.match(hist, /No las guardamos/);
});

test('el historial enseña la grasa como rango, no como número exacto', () => {
  // Falsa precisión desde una foto sin calibrar. En un historial es peor:
  // se compara contra el anterior y una décima inventada se lee como progreso.
  const hist = leerCodigo('app', 'body-scan-historial.tsx');
  assert.match(hist, /function rangoGrasa/);
  assert.ok(
    !/estimated_fat_pct\}%/.test(hist),
    'pinta el porcentaje exacto en alguna parte',
  );
});

test('un fallo de red no se enseña como "no tienes análisis"', () => {
  // Decirle eso a alguien que sí los tiene es decirle que perdió su historial.
  const hist = leerCodigo('app', 'body-scan-historial.tsx');
  assert.match(hist, /No pudimos cargar tus análisis/);
  assert.match(hist, /Todavía no tienes análisis/);
});
