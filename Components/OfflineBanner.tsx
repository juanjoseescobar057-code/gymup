// Components/OfflineBanner.tsx
// ─────────────────────────────────────────────────────────
// Banner de "sin conexión". Tres reglas que lo diferencian de un error
// genérico:
//   1. NO bloquea: es una franja, no un modal. Se puede seguir entrenando.
//   2. Dice qué SÍ funciona, no solo qué falló.
//   3. Trae reintento manual, porque volver a tener señal no siempre
//      dispara un evento del sistema a tiempo.
// ─────────────────────────────────────────────────────────

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Fonts, Radii, Spacing, Type, A11y } from '../constants/theme';
import { useOffline } from '../lib/useOffline';

type Props = {
  /** Qué sigue funcionando en ESTA pantalla sin conexión. */
  disponible?: string;
};

export default function OfflineBanner({
  disponible = 'Puedes entrenar y registrar series; se sincroniza al volver la señal.',
}: Props) {
  const { offline, recheck } = useOffline();
  if (!offline) return null;

  return (
    <View style={s.wrap} accessible accessibilityLiveRegion="polite"
      accessibilityLabel={`Sin conexión. ${disponible}`}>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>Sin conexión</Text>
        <Text style={s.body}>{disponible}</Text>
      </View>
      <TouchableOpacity onPress={recheck} style={s.btn} hitSlop={A11y.hitSlop}
        accessibilityRole="button" accessibilityLabel="Reintentar la conexión">
        <Text style={s.btnTxt}>Reintentar</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: 'rgba(255,180,84,0.12)',
    borderWidth: 1, borderColor: Colors.warning + '55',
    borderRadius: Radii.md,
    paddingVertical: 10, paddingHorizontal: Spacing.md,
    marginHorizontal: Spacing.lg, marginBottom: Spacing.sm,
  },
  title: { fontFamily: Fonts.bodySemi, fontSize: Type.body, color: Colors.warning },
  body: { fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.textSecondary, lineHeight: 17 },
  btn: {
    borderWidth: 1, borderColor: Colors.warning + '99', borderRadius: Radii.sm,
    paddingVertical: 7, paddingHorizontal: 12,
  },
  btnTxt: { fontFamily: Fonts.bodySemi, fontSize: Type.caption, color: Colors.warning },
});
