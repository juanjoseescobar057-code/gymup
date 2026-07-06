// components/KeyboardToolbar.tsx
// Barra que aparece encima del teclado numérico con botón "Listo"
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Colors, Fonts } from '../constants/theme';

type Props = {
  onDone: () => void;
  label?: string;
};

export function KeyboardToolbar({ onDone, label = 'Listo ✓' }: Props) {
  if (Platform.OS !== 'ios') return null; // Android ya tiene botón Done nativo
  return (
    <View style={s.bar}>
      <Text style={s.hint}>Ingresa el valor</Text>
      <TouchableOpacity onPress={onDone} style={s.btn} activeOpacity={0.7}>
        <Text style={s.btnTxt}>{label}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1a1a1e',
    borderTopWidth: 1,
    borderTopColor: '#2a2a2e',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: '#555',
  },
  btn: {
    backgroundColor: '#c8ff3e',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  btnTxt: {
    fontFamily: Fonts.bodySemi,
    fontSize: 14,
    color: '#0a0a0b',
  },
});
