// Components/GuardiaRecuperacion.tsx
// ─────────────────────────────────────────────────────────
// Bloquear, no esconder.
//
// El modo recuperación llevaba meses siendo condicional de renderizado: tres
// pantallas leían las banderas y ocultaban bloques. Eso no cierra nada:
//
//   • app/_layout.tsx registra body-scan, food-scan, fridge-scan y food-manual
//     como pantallas, y app.json declara el scheme "gymup". Un enlace
//     gymup://body-scan entra sin pasar por ningún botón.
//   • La MISMA pantalla de inicio que mostraba el aviso seguía enseñando
//     "Escanear cuerpo" 260 líneas más abajo.
//
// Mientras la pantalla no se defienda sola, quitarle el botón solo mueve el
// problema de sitio. Por eso el guardia va DENTRO de cada ruta sensible.
//
// NO ES UN REDIRECT. Un router.replace silencioso se lee como un fallo de la
// app: la persona toca algo y desaparece. Aquí se explica qué pasó, se dice que
// sus datos siguen ahí, y se ofrece volver.
// ─────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUserStore } from '../store/userStore';
import { AVISO_RECUPERACION, bloqueada, type AreaSensible } from '../lib/recoveryMode';
import { Colors, Fonts, Radii, Spacing, Type, A11y } from '../constants/theme';

export default function GuardiaRecuperacion({
  area,
  titulo,
  children,
}: {
  /** Qué protege esta pantalla. */
  area: AreaSensible;
  /** Cabecera que se muestra al bloquear. */
  titulo: string;
  children: ReactNode;
}) {
  const recuperacion = useUserStore((s: any) => s.recuperacion);

  if (!bloqueada(recuperacion, area)) return <>{children}</>;

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
        <Text style={s.icono}>🌱</Text>
        <Text style={s.titulo}>Esto lo tenemos en pausa</Text>
        <Text style={s.texto}>{AVISO_RECUPERACION}</Text>

        <TouchableOpacity
          style={s.btn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <Text style={s.btnTxt}>VOLVER</Text>
        </TouchableOpacity>

        {/* Salida deliberada: se cambia en el tamizaje, con lo que eso implica,
            y no con un interruptor rápido en el momento de peor impulso. */}
        <TouchableOpacity
          style={s.secundario}
          onPress={() => router.push('/health' as any)}
          accessibilityRole="button"
          accessibilityLabel="Revisar Mi salud"
        >
          <Text style={s.secundarioTxt}>Revisar Mi salud</Text>
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
  secundario: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.lg,
  },
  secundarioTxt: { fontFamily: Fonts.heading, fontSize: Type.body, color: Colors.textPrimary },
});
