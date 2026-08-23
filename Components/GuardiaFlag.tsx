// Components/GuardiaFlag.tsx
// ─────────────────────────────────────────────────────────
// El interruptor remoto, aplicado a una pantalla.
//
// Va DENTRO de la ruta por el mismo motivo que el guardia del modo
// recuperación: la pantalla se abre también por enlace directo y desde
// cualquier botón que exista mañana. Esconder el botón de origen no apaga nada.
//
// Y explica en vez de expulsar: un botón que no responde se lee como una app
// rota. Aquí se dice que fue una decisión y que los datos siguen ahí.
// ─────────────────────────────────────────────────────────

import { useEffect, useState, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { flag, suscribirseAFlags, MOTIVO_POR_DEFECTO, type ClaveFlag, type Flag } from '../lib/featureFlags';
import { Colors, Fonts, Radii, Spacing, Type, A11y } from '../constants/theme';

export default function GuardiaFlag({
  clave,
  titulo,
  children,
}: {
  clave: ClaveFlag;
  titulo: string;
  children: ReactNode;
}) {
  // REACTIVO. Antes se leía la variable de módulo una sola vez, en el render:
  // si la consulta de los interruptores terminaba después, la pantalla se
  // quedaba con el valor de partida y no se enteraba nunca. Con las funciones de
  // riesgo bloqueadas por defecto, eso significaba dejarlas bloqueadas para
  // siempre — igual de roto que dejarlas abiertas, solo que hacia el otro lado.
  const [f, setF] = useState<Flag>(() => flag(clave));
  useEffect(() => suscribirseAFlags(() => setF(flag(clave))), [clave]);

  if (f.activo) return <>{children}</>;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity
          style={s.cerrar}
          onPress={() => router.back()}
          hitSlop={A11y.hitSlopLg}
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <Text style={s.cerrarTxt}>✕</Text>
        </TouchableOpacity>
        <Text style={s.headerTitulo} accessibilityRole="header">{titulo}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.centro}>
        <Text style={s.icono}>🛠️</Text>
        <Text style={s.titulo}>En pausa</Text>
        <Text style={s.texto}>{f.motivo || MOTIVO_POR_DEFECTO}</Text>
        <TouchableOpacity
          style={s.btn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <Text style={s.btnTxt}>VOLVER</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  cerrar: {
    width: 40,
    height: 40,
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cerrarTxt: { fontFamily: Fonts.headingBold, fontSize: 16, color: Colors.textMuted },
  headerTitulo: { fontFamily: Fonts.heading, fontSize: 15, color: Colors.textPrimary, letterSpacing: 1 },
  centro: { flexGrow: 1, justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  icono: { fontSize: 42, textAlign: 'center' },
  titulo: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.textPrimary, textAlign: 'center' },
  texto: {
    fontFamily: Fonts.body,
    fontSize: Type.bodyLg,
    lineHeight: 24,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  btn: {
    backgroundColor: Colors.accent,
    borderRadius: Radii.lg,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  btnTxt: { fontFamily: Fonts.heading, fontSize: 16, color: '#0a0a0b', letterSpacing: 0.8 },
});
