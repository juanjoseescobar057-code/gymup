// __tests__/loteCuenta.test.ts
// ─────────────────────────────────────────────────────────
// Segundo lote de la auditoría profunda: los botones de cuenta, uno por uno.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { traducirErrorAuth } from '../lib/erroresAuth';

const leerCodigo = (...p: string[]) =>
  fs
    .readFileSync(path.join(process.cwd(), ...p), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const perfil = leerCodigo('app', '(tabs)', 'profile.tsx');
const cuenta = leerCodigo('lib', 'account.ts');

// ── Errores en castellano, sin texto del proveedor ──

test('los errores de Supabase Auth se traducen y nunca se enseñan crudos', () => {
  assert.equal(
    traducirErrorAuth('Invalid login credentials'),
    'El correo o la contraseña no coinciden. Revísalos e inténtalo otra vez.',
  );
  assert.match(traducirErrorAuth('User already registered'), /ya tiene cuenta/);
  assert.match(traducirErrorAuth('Email rate limit exceeded'), /Espera un minuto/);
  // Lo desconocido no se enseña tal cual.
  const raro = traducirErrorAuth('AuthApiError: something_weird_0x1F');
  assert.ok(!/0x1F|weird|AuthApiError/.test(raro), 'un error desconocido se enseñó crudo');
});

test('iniciar sesión y vincular correo pasan por la traducción', () => {
  const i = cuenta.indexOf('export async function signInExisting');
  assert.match(cuenta.slice(i, i + 600), /traducirErrorAuth\(error\.message\)/);
  const j = cuenta.indexOf('export async function linkEmailPassword');
  assert.match(cuenta.slice(j, j + 900), /traducirErrorAuth\(error\.message\)/);
});

// ── Recuperar contraseña no miente ──

test('un rate limit al pedir el enlace se dice, no se traga', () => {
  // Devolvía ok:true con un 429 detrás y la pantalla decía "te enviamos el
  // enlace" a alguien a quien no se le envió nada.
  const i = cuenta.indexOf('export async function requestPasswordReset');
  const cuerpo = cuenta.slice(i, i + 1500);
  assert.match(cuerpo, /rate limit\|too many\|over_email_send_rate_limit\|429/);
  assert.match(cuerpo, /Pediste varios enlaces seguidos/);
  assert.match(cuerpo, /error sending\|smtp\|mail/, 'un fallo del servidor de correo se sigue tragando');
});

test('pero sigue sin revelar si la cuenta existe', () => {
  const i = cuenta.indexOf('export async function requestPasswordReset');
  const cuerpo = cuenta.slice(i, i + 1500);
  assert.ok(!/no está registrad|user not found|not found/i.test(cuerpo));
  // El camino normal (sin error) responde ok sin distinguir.
  assert.match(cuerpo, /return \{ ok: true \};/);
});

// ── Cerrar sesión: se comprueba y no deja el teléfono a medias ──

test('cerrar sesión comprueba el signOut ANTES de borrar lo local', () => {
  const i = perfil.indexOf('async function handleLogout');
  const fin = perfil.indexOf('\n  async function ', i + 10);
  const bloque = perfil.slice(i, fin);
  const iSignOut = bloque.indexOf('const { error: errSalir } = await supabase.auth.signOut()');
  assert.ok(iSignOut > 0, 'el signOut sigue sin comprobarse');
  assert.ok(iSignOut < bloque.indexOf('olvidarSesion()'), 'se vacía el store antes de saber si la sesión se cerró');
  assert.ok(iSignOut < bloque.indexOf('borrarDatosLocales()'), 'se borran datos locales antes de saber si la sesión se cerró');
  assert.match(bloque, /if \(errSalir\) \{[\s\S]*?return;/, 'un fallo al cerrar sesión no detiene el borrado');
  // Y no queda un segundo signOut suelto al final.
  assert.equal((bloque.match(/supabase\.auth\.signOut\(\)/g) ?? []).length, 1, 'hay dos signOut en el logout');
});

test('un fallo al cerrar sesión se explica y deja todo intacto', () => {
  assert.match(perfil, /No pudimos cerrar la sesión/);
  assert.match(perfil, /Tu cuenta sigue abierta y no se ha tocado nada/);
});

// ── Borrar cuenta: un toque, no dos ──

test('borrar cuenta tiene estado ocupado y un segundo toque no relanza', () => {
  assert.match(perfil, /const \[deleting, setDeleting\] = useState\(false\)/);
  const i = perfil.indexOf('async function handleDeleteAccount');
  const bloque = perfil.slice(i, i + 1200);
  assert.match(bloque, /if \(deleting\) return;/);
  assert.match(bloque, /setDeleting\(true\);\s*const res = await deleteAccountServerSide\(\)/);
  assert.match(bloque, /setDeleting\(false\)/, 'tras un fallo el botón queda muerto para siempre');
});

// ── "Anónimo" es un hecho, no un fallo de red ──

test('un fallo de red al leer el correo NO convierte la cuenta en anónima', () => {
  assert.match(perfil, /useState<string \| null \| undefined>\(undefined\)/);
  assert.match(perfil, /const isAnon = accountEmail === null;/);
  assert.match(perfil, /const cuentaDesconocida = accountEmail === undefined;/);
  assert.match(perfil, /\.catch\(\(\) => setAccountEmail\(undefined\)\)/, 'el fallo de red deja el valor que había');
});

test('con la cuenta sin comprobar, no se amenaza con perderlo todo', () => {
  assert.match(perfil, /No pudimos comprobar si tu cuenta tiene correo/);
  assert.match(perfil, /Comprobando tu cuenta/);
});

// ── Arranque sin red ──

test('sin red y con el token vencido no se manda al onboarding', () => {
  const idx = leerCodigo('app', 'index.tsx');
  assert.match(idx, /const \{ data: \{ session \}, error: errSesion \} = await supabase\.auth\.getSession\(\)/);
  const i = idx.indexOf('errSesion &&');
  assert.ok(i > 0, 'el error de getSession se ignora');
  assert.match(idx.slice(i, i + 300), /setConnectionError\(true\)/);
  // Y va ANTES de decidir que no hay sesión.
  assert.ok(i < idx.indexOf("router.replace('/(auth)/onboarding'"));
});

// ── Alguien escucha SIGNED_OUT ──

test('si la sesión se revoca, la app se entera y vuelve al inicio', () => {
  const layout = leerCodigo('app', '_layout.tsx');
  assert.match(layout, /supabase\.auth\.onAuthStateChange/);
  assert.match(layout, /evento === 'SIGNED_OUT'/);
  assert.match(layout, /olvidarSesion\(\)/);
  assert.match(layout, /sub\.subscription\.unsubscribe\(\)/, 'la suscripción no se limpia');
});
