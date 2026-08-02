// Components/HelpButton.tsx
// ─────────────────────────────────────────────────────────
// Botón "?" que abre el chat del coach YA preguntando por la pantalla donde
// está el usuario.
//
// Por qué así y no un tour de globos: el tour solo se ve una vez, hay que
// mantenerlo cada vez que cambia la UI, y responde las preguntas que NOSOTROS
// creemos que la gente tiene. El coach ya conoce el plan, los macros y el
// progreso de quien pregunta, así que puede explicar la pantalla EN SU
// contexto ("tus 2100 kcal salen de tu peso y tu objetivo") y seguir
// respondiendo lo que venga después. Es la ventaja de tener un coach IA: no
// desperdiciarla escribiendo ayuda estática.
// ─────────────────────────────────────────────────────────

import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Colors, Fonts, Radii, A11y } from '../constants/theme';

type Props = {
  /** Qué debe explicar el coach. Escríbelo como lo preguntaría el usuario. */
  pregunta: string;
  /** Nombre de la pantalla, para la etiqueta del lector de pantalla. */
  pantalla: string;
};

export default function HelpButton({ pregunta, pantalla }: Props) {
  return (
    <TouchableOpacity
      style={s.btn}
      activeOpacity={0.7}
      hitSlop={A11y.hitSlop}
      onPress={() => router.push({ pathname: '/coach-chat', params: { q: pregunta } } as any)}
      accessibilityRole="button"
      accessibilityLabel={`Ayuda sobre ${pantalla}`}
      accessibilityHint="Abre el chat con tu coach explicando esta pantalla"
    >
      <Text style={s.txt}>?</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  btn: {
    width: 32,
    height: 32,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txt: { fontFamily: Fonts.headingSemi, fontSize: 16, color: Colors.textSecondary },
});
