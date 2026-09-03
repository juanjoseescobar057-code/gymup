// __tests__/lasPaginasLegalesSonPublicables.test.ts
// ─────────────────────────────────────────────────────────
// Las páginas legales son PÚBLICAS: las lee cualquiera, incluido el revisor de
// Google Play. No pueden contener notas internas.
//
// Estaban publicadas en rityvo.com con este banner dentro:
//
//   "⚠️ Antes de publicar: este documento fue redactado como base sólida...
//    recomendamos que un abogado lo revise antes de publicarlo."
//
// Es una nota del desarrollador a sí mismo. Publicada, le dice al mundo —y a
// quien revisa la ficha de la tienda— que la política de privacidad de una app
// de salud no está revisada legalmente. Esa URL es justo la que Play exige.
//
// El estado de "pendiente de revisión legal" se lleva en
// docs/release-approvals.json, que es donde pertenece y donde nadie más lo ve.
// ─────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Las que se suben al dominio. play-store-health-compliance.md NO está aquí a
// propósito: son notas internas de cumplimiento y no se publican.
const PUBLICAS = [
  'index.html',
  'privacy-policy.html',
  'terms-of-service.html',
  'delete-account.html',
];

const FRASES_INTERNAS = [
  /antes de publicar/i,
  /\bborrador\b/i,
  /\bdraft\b/i,
  /pendiente de revisi[oó]n/i,
  /no sustituye asesor[ií]a legal/i,
  /pide revisi[oó]n de un abogado/i,
  /\bTODO\b/,
  /\bFIXME\b/,
];

test('ninguna página pública lleva notas internas', () => {
  const culpables: string[] = [];
  for (const nombre of PUBLICAS) {
    const p = path.join(process.cwd(), 'docs', 'legal', nombre);
    assert.ok(fs.existsSync(p), `falta ${nombre}: es una de las URLs que exige Play`);
    const html = fs.readFileSync(p, 'utf8');
    for (const frase of FRASES_INTERNAS) {
      if (frase.test(html)) culpables.push(`${nombre}: ${frase}`);
    }
  }
  assert.deepEqual(
    culpables,
    [],
    'hay notas internas en documentos públicos:\n  ' + culpables.join('\n  '),
  );
});

test('los documentos siguen completos', () => {
  // Quitar un bloque no puede haberse llevado medio documento por delante.
  const minimos: Record<string, number> = {
    'privacy-policy.html': 10,
    'terms-of-service.html': 12,
  };
  for (const [nombre, minimo] of Object.entries(minimos)) {
    const html = fs.readFileSync(path.join(process.cwd(), 'docs', 'legal', nombre), 'utf8');
    const secciones = (html.match(/<h2/g) ?? []).length;
    assert.ok(secciones >= minimo, `${nombre} bajó a ${secciones} secciones (mínimo ${minimo})`);
  }
});

test('las dos URLs que exige Play existen como archivo', () => {
  // La de privacidad y la de borrado de cuenta. Sin ellas no se puede publicar,
  // y renombrar un archivo rompería los enlaces ya pegados en Play Console.
  for (const nombre of ['privacy-policy.html', 'delete-account.html']) {
    assert.ok(
      fs.existsSync(path.join(process.cwd(), 'docs', 'legal', nombre)),
      `falta ${nombre}: es una URL ya registrada en Play Console`,
    );
  }
});

test('el estado de las aprobaciones se lleva fuera de lo público', () => {
  const aprobaciones = path.join(process.cwd(), 'docs', 'release-approvals.json');
  assert.ok(fs.existsSync(aprobaciones), 'no existe el registro de aprobaciones');
  const json = JSON.parse(fs.readFileSync(aprobaciones, 'utf8'));
  assert.ok(
    JSON.stringify(json).includes('legal'),
    'el registro de aprobaciones no menciona la revisión legal: entonces el aviso se quitó de lo público y no quedó en ninguna parte',
  );
});
