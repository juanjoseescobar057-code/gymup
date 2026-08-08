// Components/Icon.tsx
// ─────────────────────────────────────────────────────────
// Iconos vectoriales para los CONTROLES: botones cuyo único aspecto visual es
// el icono. Un emoji ahí es frágil por tres motivos:
//   • cambia de dibujo según el fabricante del teléfono, así que el botón no
//     se ve igual para dos personas;
//   • no hereda el color del estado (activo/inactivo), y en este diseño el
//     color ES la señal de selección;
//   • en algunos equipos sencillamente no existe y sale un recuadro.
//
// Los emojis DECORATIVOS o de contenido (🏋️ junto al nombre de un ejercicio,
// 🔥 de la racha) se quedan: ahí el emoji es el contenido, no el control, y
// sustituirlos por trazos grises perdería carácter sin ganar nada.
// ─────────────────────────────────────────────────────────

import Svg, { Path, Line } from 'react-native-svg';

export type IconName = 'volumen' | 'volumen-off';

type Props = { name: IconName; color: string; size?: number };

export default function Icon({ name, color, size = 22 }: Props) {
  const trazo = {
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      // El botón que lo contiene ya lleva su accessibilityLabel: el icono no
      // debe anunciarse por separado ni leerse como "altavoz".
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" {...trazo} />
      {name === 'volumen' && (
        <>
          <Path d="M15.5 9.2a4 4 0 0 1 0 5.6" {...trazo} />
          <Path d="M18 6.8a7.5 7.5 0 0 1 0 10.4" {...trazo} />
        </>
      )}
      {name === 'volumen-off' && (
        <>
          <Line x1="16" y1="9.5" x2="21" y2="14.5" {...trazo} />
          <Line x1="21" y1="9.5" x2="16" y2="14.5" {...trazo} />
        </>
      )}
    </Svg>
  );
}
