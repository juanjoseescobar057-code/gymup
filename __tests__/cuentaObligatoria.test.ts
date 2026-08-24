// __tests__/cuentaObligatoria.test.ts
// ─────────────────────────────────────────────────────────
// La cuenta dejó de ser opcional, y la puerta de vuelta existe de verdad.
//
// Lo que había: `signInAnonymously()` era todo el sistema de cuentas y el
// correo se pedía como "opcional, muy recomendado". Una sesión anónima no
// tiene ninguna credencial que presentar, así que reinstalar la app, cambiar
// de teléfono o borrar sus datos dejaba la cuenta inalcanzable — sin logout de
// por medio y sin vuelta atrás. Quien hubiera pagado recuperaba la suscripción
// por la tienda y NO sus datos: racha, historial, plan y fotos se quedaban
// huérfanos en filas que ya nadie podía reclamar.
//
// Y la puerta de vuelta existía pero estaba mal puesta: el enlace de "ya tengo
// cuenta" vivía al FINAL del paso 1, por debajo del formulario, del botón de
// continuar y del texto legal. Quien reinstala no lee esa pantalla entera:
// teclea su nombre, le da a continuar, y ya está creándose una segunda cuenta
// encima de la suya. Por eso el test que importa no es "existe el enlace" sino
// DÓNDE está — el primero pasaba ya antes del arreglo.
//
// Todos leen el código con los comentarios quitados: los comentarios de este
// repositorio citan lo que se eliminó, así que un ancla ingenua se satisface
// sola contra el propio comentario que la describe.
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

const onboarding = leerCodigo('app', '(auth)', 'onboarding.tsx');

// ── La puerta de vuelta se abre ──

test('algo llama a setSignInSheet(true): la hoja de iniciar sesión se abre', () => {
  // Guardia de regresión, no un hallazgo: esto ya se cumplía. Sigue puesto
  // porque borrar el enlace y dejar la hoja montada es un cambio de una línea.
  assert.ok(
    /setSignInSheet\(true\)/.test(onboarding),
    'la hoja de iniciar sesión se renderiza pero nada la abre: quien reinstale no puede volver a su cuenta',
  );
});

test('el enlace de volver no está duplicado en el paso 1', () => {
  // Al moverlo arriba se quedó el viejo abajo un rato. Dos enlaces al mismo
  // sitio en una pantalla se leen como dos cosas distintas.
  const iPaso1 = onboarding.indexOf('{step === 1 &&');
  const iPaso2 = onboarding.indexOf('{step === 2 &&');
  const veces = onboarding.slice(iPaso1, iPaso2).split('setSignInSheet(true)').length - 1;
  assert.equal(veces, 1, `hay ${veces} enlaces de iniciar sesión en el paso 1`);
});

test('la hoja de iniciar sesión sigue montada en el onboarding', () => {
  // Abrirla sin renderizarla sería el fallo simétrico.
  assert.match(onboarding, /mode="signin"/);
  assert.match(onboarding, /visible=\{signInSheet\}/);
});

test('el enlace de volver está en el PRIMER paso, antes de teclear nada', () => {
  // Reconocer "ya tengo cuenta" después de rellenar nombre, edad y peso es
  // reconocerlo tarde: para entonces ya rehizo el trabajo que venía a evitar.
  const iPaso1 = onboarding.indexOf('{step === 1 &&');
  const iPaso2 = onboarding.indexOf('{step === 2 &&');
  assert.ok(iPaso1 >= 0 && iPaso2 > iPaso1, 'no encontré los pasos del onboarding');
  // Dentro del TRAMO del paso 1. Con indexOf sobre el archivo entero encontraba
  // la llamada de handleFinish —la del correo ya registrado— y daba por buena
  // una pantalla sin enlace ninguno.
  const paso1 = onboarding.slice(iPaso1, iPaso2);
  assert.ok(
    paso1.includes('setSignInSheet(true)'),
    'el enlace de iniciar sesión no está en el paso 1',
  );
  // Y antes del primer campo del formulario.
  assert.ok(
    paso1.indexOf('setSignInSheet(true)') < paso1.indexOf('¿Cómo te llamas?'),
    'el enlace va por debajo del formulario: se reconoce "ya tengo cuenta" después de rehacerlo',
  );
});

// ── La cuenta es obligatoria ──

test('el correo ya no se anuncia como opcional', () => {
  assert.ok(
    !/opcional, muy recomendado/.test(onboarding),
    'el rótulo sigue diciendo que el correo es opcional',
  );
});

test('vincular el correo no está condicionado a que lo haya escrito', () => {
  // `if (email.trim())` era la puerta trasera: sin correo no se vinculaba nada
  // y el registro seguía adelante en anónimo.
  assert.ok(
    !/if \(email\.trim\(\)\)/.test(onboarding),
    'el enlace del correo sigue siendo condicional: se puede terminar sin cuenta',
  );
});

test('handleFinish valida la cuenta ANTES de crear nada', () => {
  const iValida = onboarding.indexOf('faltaEnLaCuenta()');
  const iPantalla = onboarding.indexOf('setStep(4)');
  const iAuth = onboarding.indexOf('signInAnonymously');
  assert.ok(iValida >= 0, 'no existe la comprobación de la cuenta');
  assert.ok(
    iValida < iPantalla && iValida < iAuth,
    'la validación va después de arrancar el registro: el usuario descubre el problema en la pantalla de "generando tu plan"',
  );
});

test('si vincular falla, el registro se detiene', () => {
  // Antes avisaba y seguía: "Seguimos con tu registro. Puedes añadirlo más
  // tarde desde Perfil." Ese aviso llegaba en mitad de la pantalla de carga,
  // donde nadie lee, y dejaba exactamente la cuenta anónima que esto evita.
  assert.ok(
    !/Seguimos con tu registro/.test(onboarding),
    'el fallo al vincular sigue dejando continuar en anónimo',
  );
  const iFallo = onboarding.indexOf('if (!link.ok)');
  assert.ok(iFallo >= 0, 'no encontré el manejo del fallo al vincular');
  const bloque = onboarding.slice(iFallo, iFallo + 1400);
  assert.ok(bloque.includes('setStep(3)'), 'no devuelve al formulario');
  assert.ok(bloque.includes('return;'), 'no corta el registro');
});

test('un correo ya registrado ofrece iniciar sesión, no inventarse otro', () => {
  // Mandarlo a usar otra dirección le deja una segunda cuenta vacía y sus
  // datos en la primera: justo el desenlace que todo esto evita.
  const iFallo = onboarding.indexOf('if (!link.ok)');
  const bloque = onboarding.slice(iFallo, iFallo + 1400);
  assert.ok(bloque.includes('Iniciar sesión'), 'no ofrece volver a su cuenta');
  assert.ok(bloque.includes('setSignInSheet(true)'), 'el botón no abre la hoja');
});

// ── La contraseña se confirma ──

test('hay campo de repetir contraseña y se compara', () => {
  // Sin confirmación, una errata deja la cuenta con una contraseña que nadie
  // conoce: el correo queda vinculado, la persona se cree a salvo, y al
  // reinstalar no puede entrar. Mismo desenlace, descubierto más tarde.
  assert.match(onboarding, /password2/);
  assert.ok(
    /password !== password2/.test(onboarding),
    'las dos contraseñas no se comparan en ningún sitio',
  );
});

test('la comprobación de contraseña corta sigue puesta', () => {
  const cuenta = leerCodigo('lib', 'account.ts');
  assert.ok(cuenta.includes('password.length < 8'), 'se puede crear una cuenta con contraseña de 1 carácter');
});

// ── Ninguna otra vía crea sesiones anónimas ──

test('signInAnonymously se llama en un solo sitio', () => {
  const dirs = ['app', 'lib', 'Components', 'store'];
  const encontrados: string[] = [];
  const recorrer = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (/\.tsx?$/.test(e.name)) {
        const codigo = fs
          .readFileSync(p, 'utf8')
          .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        if (codigo.includes('signInAnonymously')) encontrados.push(p.split(path.sep).join('/'));
      }
    }
  };
  dirs.forEach(recorrer);
  assert.deepEqual(
    encontrados,
    ['app/(auth)/onboarding.tsx'],
    'otra pantalla crea sesiones anónimas: cada una es una cuenta irrecuperable más',
  );
});
