// lib/contrast.ts
// ─────────────────────────────────────────────────────────
// Contraste WCAG 2.2, como función PURA para poder probarlo.
//
// Existe porque el contraste dejó de ser una opinión de diseño: la paleta
// tenía texto a ~2.6:1 sobre el fondo y se usaba para instrucciones que el
// usuario TIENE que leer. Con esto, la regla se comprueba en la suite de
// tests y una regresión falla el build en vez de descubrirse en una auditoría.
//
// Referencia: https://www.w3.org/TR/WCAG22/#contrast-minimum
//   • Texto normal: 4.5:1
//   • Texto grande (>=18.66px bold o >=24px) y elementos no textuales: 3:1
// ─────────────────────────────────────────────────────────

export const WCAG_AA_TEXTO = 4.5;
export const WCAG_AA_TEXTO_GRANDE = 3;

/** #rgb, #rrggbb o rgba(r,g,b,a) → [r,g,b] en 0-255. Lanza si no se entiende. */
export function parseColor(color: string): [number, number, number] {
  const c = color.trim().toLowerCase();

  const rgba = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];

  const hex = c.replace('#', '');
  if (hex.length === 3) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  if (hex.length === 6) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  throw new Error(`Color no reconocido: ${color}`);
}

/** Luminancia relativa (WCAG). */
export function luminancia(color: string): number {
  const [r, g, b] = parseColor(color);
  const canal = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Razón de contraste entre dos colores. Siempre >= 1. */
export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const claro = Math.max(la, lb);
  const oscuro = Math.min(la, lb);
  return (claro + 0.05) / (oscuro + 0.05);
}

/** ¿Cumple el mínimo de texto normal? */
export function cumpleTextoNormal(fg: string, bg: string): boolean {
  return contraste(fg, bg) >= WCAG_AA_TEXTO;
}

/** ¿Cumple el mínimo de texto grande / elementos no textuales? */
export function cumpleTextoGrande(fg: string, bg: string): boolean {
  return contraste(fg, bg) >= WCAG_AA_TEXTO_GRANDE;
}
