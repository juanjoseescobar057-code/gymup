// __tests__/legal.test.ts
// ─────────────────────────────────────────────────────────
// La casilla de "acepto los términos" era un useState(false). Bloqueaba el
// botón y no se guardaba en ningún sitio: al salir de la pantalla no quedaba
// rastro de que nadie hubiera autorizado nada — y justo después la app
// escribía un tamizaje PAR-Q+ entero, que es dato sensible.
//
// La Ley 1581 de 2012 y el Decreto 1377 de 2013 piden que el responsable pueda
// PROBAR la autorización. Estos tests vigilan las dos formas de que la prueba
// no valga: que no exista, y que sea de un documento que la persona no leyó.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  VERSIONES,
  DOCUMENTOS,
  documentosPendientes,
  todoAceptado,
  consentimientosAGuardar,
} from '../lib/legal';

// ── La versión guardada tiene que ser la que la persona vio ──

const ARCHIVOS: Record<string, string[]> = {
  terms: ['docs/legal/terms-of-service.md', 'docs/legal/terms-of-service.html'],
  privacy: ['docs/legal/privacy-policy.md', 'docs/legal/privacy-policy.html'],
};

/** La versión que declara la cabecera del documento. */
function versionDelDocumento(rel: string): string | null {
  const texto = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  // El cierre de negrita va DENTRO de la etiqueta en los dos formatos:
  //   .md    → **Versión:** 1.3
  //   .html  → <strong>Versión:</strong> 1.3
  // así que hay que saltárselo antes del número.
  const m = texto.match(/Versi[oó]n\s*:?\s*(?:\*\*|<\/strong>|<\/b>)?\s*(\d+\.\d+)/i);
  return m ? m[1] : null;
}

for (const doc of DOCUMENTOS) {
  test(`la versión de ${doc} en el código coincide con la del documento`, () => {
    // Si el texto cambia y este número no, se guarda como prueba una versión
    // que nadie leyó — y encima nadie tiene que volver a aceptar nada.
    for (const rel of ARCHIVOS[doc]) {
      const enDoc = versionDelDocumento(rel);
      assert.ok(enDoc, `no encontré la versión en ${rel}`);
      assert.equal(
        VERSIONES[doc],
        enDoc,
        `lib/legal.ts dice ${VERSIONES[doc]} y ${rel} dice ${enDoc}`,
      );
    }
  });
}

test('el .md y el .html publicados dicen lo mismo', () => {
  // El HTML es lo que se publica y el MD lo que se edita. Si divergen, la
  // persona acepta una versión y queda registrada otra.
  for (const doc of DOCUMENTOS) {
    const [md, html] = ARCHIVOS[doc].map(versionDelDocumento);
    assert.equal(md, html, `${doc}: el .md dice ${md} y el .html dice ${html}`);
  }
});

// ── Qué falta por aceptar ──

const vigentes = () => DOCUMENTOS.map((d) => ({ document: d, version: VERSIONES[d] }));

test('sin nada guardado, falta todo', () => {
  assert.deepEqual(documentosPendientes([]), DOCUMENTOS);
  assert.equal(todoAceptado([]), false);
});

test('con todo en la versión vigente, no falta nada', () => {
  assert.deepEqual(documentosPendientes(vigentes()), []);
  assert.equal(todoAceptado(vigentes()), true);
});

test('una versión ANTERIOR no cuenta como aceptada', () => {
  // Aceptar la política 1.2 no es aceptar la 1.3. Si contara, publicar una
  // política nueva no exigiría nada a nadie y el versionado sobraría.
  const viejas = DOCUMENTOS.map((d) => ({ document: d, version: '0.9' }));
  assert.deepEqual(documentosPendientes(viejas), DOCUMENTOS);
});

test('aceptar uno solo deja el otro pendiente', () => {
  const soloTerminos = [{ document: 'terms', version: VERSIONES.terms }];
  assert.deepEqual(documentosPendientes(soloTerminos), ['privacy']);
});

test('un documento desconocido no acepta nada por su cuenta', () => {
  const raro = [{ document: 'cookies', version: '9.9' }];
  assert.deepEqual(documentosPendientes(raro), DOCUMENTOS);
});

test('no leer los consentimientos NO es haberlos aceptado', () => {
  // El caso que importa: un fallo de red no puede abrir la puerta.
  assert.equal(todoAceptado(null), false);
  assert.equal(todoAceptado(undefined), false);
});

// ── Lo que se guarda ──

test('se guarda una fila por documento, con su versión', () => {
  const filas = consentimientosAGuardar();
  assert.equal(filas.length, DOCUMENTOS.length);
  for (const f of filas) {
    assert.ok(DOCUMENTOS.includes(f.document));
    assert.equal(f.version, VERSIONES[f.document]);
  }
});

test('lo que se guarda es exactamente lo que deja de estar pendiente', () => {
  // Si estas dos listas se separaran, alguien aceptaría y le seguiría faltando.
  assert.deepEqual(documentosPendientes(consentimientosAGuardar()), []);
});

// ── El esquema aguanta lo que el módulo promete ──

const setup = fs.readFileSync(path.join(process.cwd(), 'supabase', 'setup.sql'), 'utf8');

test('la tabla de consentimientos existe y guarda versión y fecha', () => {
  assert.match(setup, /create table if not exists public\.legal_consents/);
  for (const col of ['document', 'version', 'accepted_at']) {
    assert.ok(new RegExp(`\\b${col}\\b`).test(setup), `falta la columna ${col}`);
  }
});

test('un consentimiento no se puede modificar ni borrar', () => {
  // Una prueba que el interesado puede reescribir deja de ser prueba. Revocar
  // se hace borrando la cuenta, y de eso se encarga el ON DELETE CASCADE.
  const grants = setup
    .split('\n')
    .filter((l) => l.includes('on public.legal_consents to'));
  assert.ok(grants.length > 0, 'la tabla necesita su grant explícito');
  for (const g of grants) {
    assert.ok(!/\bupdate\b/.test(g), `no puede concederse update: ${g}`);
    assert.ok(!/\bdelete\b/.test(g), `no puede concederse delete: ${g}`);
  }
  assert.ok(
    !/create policy legal_consents_(update|delete)/.test(setup),
    'no debe haber política de update ni de delete',
  );
});

test('el borrado de la cuenta se lleva los consentimientos', () => {
  const bloque = setup.match(/create table if not exists public\.legal_consents[\s\S]*?\);/)?.[0] ?? '';
  assert.match(bloque, /on delete cascade/);
});
