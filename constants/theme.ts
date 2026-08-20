// constants/theme.ts
// ─────────────────────────────────────────────────────────
// Sistema de diseño de Rityvo
// Paleta oscura con acento verde eléctrico
//
// CONTRASTE: los valores de texto están elegidos para cumplir WCAG 2.2 AA
// sobre `bg` y sobre `bgCard`, y eso se COMPRUEBA en __tests__/contrast.test.ts.
// Si alguien vuelve a bajar un token de texto, la suite falla.
//
// El pecado anterior era `textMuted: '#555555'`, que da ~2.6:1 sobre el fondo
// —muy por debajo del 4.5:1 exigido— y se usaba en toda la app para
// instrucciones, unidades y descripciones que el usuario TIENE que leer. Gris
// sobre casi negro se ve elegante en una captura y es ilegible al sol o para
// alguien con visión reducida.
// ─────────────────────────────────────────────────────────

export const Colors = {
  // Fondos
  bg: '#0e0e10',          // Fondo principal (casi negro)
  bgCard: '#1a1a1e',      // Fondo de tarjetas
  bgInput: '#111113',     // Fondo de inputs
  bgSelected: 'rgba(200,255,62,0.08)', // Tarjeta seleccionada

  // Acento principal
  accent: '#c8ff3e',      // Verde eléctrico
  accentDark: '#7dcc00',  // Verde oscuro (para gradientes)
  accentMuted: 'rgba(200,255,62,0.12)', // Acento suave (fondos badges)
  accentBorder: 'rgba(200,255,62,0.25)', // Borde acento

  // Textos — los tres primeros son LEGIBLES y cumplen AA.
  textPrimary: '#f7f7f8',   // Títulos y valores
  textSecondary: '#b3b3ba', // Descripciones e instrucciones (9.2:1)
  textMuted: '#96969f',     // Metadata secundaria, aún legible (6.5:1)
  /**
   * SOLO para controles realmente deshabilitados. No cumple AA a propósito:
   * su trabajo es comunicar "esto no se puede tocar". Nunca para instrucciones
   * ni para texto que haga falta leer — ese fue justamente el error anterior.
   */
  textDisabled: '#686870',

  // Bordes
  border: '#34343b',
  borderStrong: '#4a4a52',

  // Semánticos
  warning: '#ffb454',
  error: '#ff6262',
  info: '#55b6ff',
  success: '#7fe36a',
  /**
   * Premium tiene color propio. Antes se pintaba con el verde de acento, que
   * es el color de ACCIÓN y de SELECCIÓN: el mismo verde significaba "toca
   * aquí", "esto está elegido" y "esto hay que pagarlo".
   */
  premium: '#b88cff',

  // Macros
  macroProtein: '#c8ff3e',
  macroCarbs: '#55b6ff',
  macroFat: '#ff9d6b',
};

export const Fonts = {
  heading: 'BarlowCondensed_900Black',
  headingBold: 'BarlowCondensed_800ExtraBold',
  headingSemi: 'BarlowCondensed_700Bold',
  body: 'DMSans_400Regular',
  bodyMedium: 'DMSans_500Medium',
  bodySemi: 'DMSans_600SemiBold',
};

export const Radii = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 24,
  full: 9999,
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// ─── Accesibilidad ───────────────────────────────────────
// Tokens para que las decisiones de accesibilidad vivan en un solo lugar
// y no se re-decidan (mal) pantalla por pantalla.

/** Tamaños de texto. `micro` es el PISO: nada más pequeño que esto.
 *  Apple HIG pide 11pt mínimo y Material 12sp para captions; 11 es el
 *  compromiso que no reflowea los layouts que ya existen. */
export const Type = {
  micro: 11,   // etiquetas de eje, unidades, badges — el piso absoluto
  caption: 12, // texto secundario
  body: 14,
  bodyLg: 16,
};

export const A11y = {
  /** hitSlop estándar para iconos pequeños: expande el área táctil sin
   *  tocar el layout visual. Úsalo cuando el botón dibujado mide menos de
   *  los 44pt (Apple) / 48dp (Material) recomendados. */
  hitSlop: { top: 10, bottom: 10, left: 10, right: 10 },
  /** hitSlop generoso para iconos de ~24px (cerrar, volver, +/-). */
  hitSlopLg: { top: 14, bottom: 14, left: 14, right: 14 },
};
