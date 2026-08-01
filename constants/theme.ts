// constants/theme.ts
// ─────────────────────────────────────────────────────────
// Sistema de diseño de GymAI
// Paleta oscura con acento verde eléctrico
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

  // Textos
  textPrimary: '#ffffff',
  textSecondary: '#888888',
  textMuted: '#555555',

  // Bordes
  border: '#2a2a2e',
  borderStrong: '#3a3a3e',

  // Semánticos
  warning: '#ff9d3a',
  error: '#ff4444',
  info: '#3a9fff',

  // Macros
  macroProtein: '#c8ff3e',
  macroCarbs: '#3a9fff',
  macroFat: '#ff7c3a',
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
