// app/workout-complete.tsx
// ─────────────────────────────────────────────────────────
// Celebración post-entrenamiento: reemplaza el Alert plano con una
// pantalla real (duración, XP, racha, PRs, badges) + compartir.
// ─────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Share, Animated,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { track } from '../lib/analytics';
import { loadHealthSafe } from '../lib/health';
import { estiramientoPara, type ContextoSalud } from '../lib/warmupMath';
import { useUserStore } from '../store/userStore';
import { Colors, Fonts, Radii, Spacing, Type } from '../constants/theme';

export default function WorkoutCompleteScreen() {
  const p = useLocalSearchParams<{
    duration?: string; exercises?: string; xp?: string; streak?: string;
    leveledUp?: string; badges?: string; prs?: string; freezeUsed?: string; grupos?: string;
  }>();

  const duration = String(p.duration ?? '0:00');
  const exercises = String(p.exercises ?? '0');
  const xp = String(p.xp ?? '0');
  const streak = String(p.streak ?? '0');
  const leveledUp = p.leveledUp === '1';
  const freezeUsed = p.freezeUsed === '1';
  const badges = p.badges ? String(p.badges).split('|').filter(Boolean) : [];
  const prs = p.prs ? String(p.prs).split('|').filter(Boolean) : [];

  // Estiramientos de lo que se acaba de entrenar, filtrados por las lesiones y
  // condiciones declaradas. Fail-closed: si el tamizaje no se puede leer, se
  // cae a la lista conservadora y se dice por qué.
  const grupos = p.grupos ? String(p.grupos).split('|').filter(Boolean) : [];
  const profile = useUserStore((s: any) => s.profile);
  const [salud, setSalud] = useState<ContextoSalud>({ injuries: [], conditions: [], desconocido: true });
  useEffect(() => {
    if (!profile) return;
    loadHealthSafe(profile.user_id)
      .then((load) => {
        if (load.status === 'unknown') return; // se queda en desconocido
        setSalud({
          injuries: load.profile?.injuries ?? [],
          conditions: load.profile?.conditions ?? [],
        });
      })
      .catch(() => {});
  }, [profile?.user_id]);

  const estiramientos = estiramientoPara(grupos, salud);
  const saludDesconocida = salud.desconocido === true;

  const scale = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  }, []);

  async function share() {
    const lines = [
      `💪 Entrené ${duration} en GymUp (${exercises} ejercicios)`,
      `🔥 Racha de ${streak} día${streak === '1' ? '' : 's'}`,
    ];
    if (prs.length > 0) lines.push(`🏅 Récord personal en ${prs.join(', ')}`);
    lines.push('¿Y tú, ya entrenaste hoy?');
    try {
      // Viralidad: quién comparte y si de verdad completó el share.
      track('share_initiated', { context: 'workout_complete', has_pr: prs.length > 0 });
      const res = await Share.share({ message: lines.join('\n') });
      if (res.action === Share.sharedAction) {
        track('share_completed', { context: 'workout_complete' });
      }
    } catch {}
  }

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Animated.Text style={[s.trophy, { transform: [{ scale }] }]}
          importantForAccessibility="no" accessibilityElementsHidden>🏆</Animated.Text>
        <Text style={s.title} accessibilityRole="header">¡ENTRENAMIENTO{'\n'}COMPLETADO!</Text>

        {/* Stats principales */}
        <View style={s.statsRow}>
          <View style={s.statCell} accessible accessibilityLabel={`Duración: ${duration}`}>
            <Text style={s.statVal}>{duration}</Text>
            <Text style={s.statLbl}>Duración</Text>
          </View>
          <View style={s.statCell} accessible accessibilityLabel={`${exercises} ejercicios`}>
            <Text style={s.statVal}>{exercises}</Text>
            <Text style={s.statLbl}>Ejercicios</Text>
          </View>
          <View style={s.statCell} accessible accessibilityLabel={`Ganaste ${xp} puntos de experiencia`}>
            <Text style={[s.statVal, { color: Colors.accent }]}>+{xp}</Text>
            <Text style={s.statLbl}>XP</Text>
          </View>
        </View>

        {/* Racha */}
        <View style={s.streakCard} accessible
          accessibilityLabel={
            `Racha de ${streak} día${streak === '1' ? '' : 's'}` +
            (freezeUsed ? '. Un comodín salvó tu racha' : '')
          }>
          <Text style={{ fontSize: 30 }}>🔥</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.streakTxt}>Racha de {streak} día{streak === '1' ? '' : 's'}</Text>
            {freezeUsed && (
              <Text style={s.freezeTxt}>🧊 Un comodín salvó tu racha</Text>
            )}
          </View>
        </View>

        {/* PRs */}
        {prs.length > 0 && (
          <View style={s.prCard} accessible
            accessibilityLabel={`¡Récord personal! En ${prs.join(', ')}`}>
            <Text style={s.prTitle} accessibilityRole="header">🏅 ¡RÉCORD PERSONAL!</Text>
            {prs.map((name) => (
              <Text key={name} style={s.prItem}>{name}</Text>
            ))}
          </View>
        )}

        {/* Nivel + badges */}
        {leveledUp && (
          <View style={s.badgeRow}>
            <Text style={s.badgeTxt}>📈 ¡Subiste de nivel!</Text>
          </View>
        )}
        {badges.map((b) => (
          <View key={b} style={s.badgeRow}>
            <Text style={s.badgeTxt}>🏅 Nuevo logro: {b}</Text>
          </View>
        ))}

        {/* Vuelta a la calma. Va ANTES de compartir y de salir: si se pone al
            final, nadie baja hasta ahí. Estiramiento ESTÁTICO — el momento de
            mantener la posición es ahora, no antes de levantar. */}
        {estiramientos.length > 0 && (
          <View style={s.estWrap}>
            <Text style={s.estTitulo} accessibilityRole="header">🧘 ANTES DE IRTE</Text>
            <Text style={s.estIntro}>
              Dos minutos de estiramiento de lo que acabas de trabajar. Hasta notar tensión, nunca dolor.
            </Text>
            {saludDesconocida && (
              <Text style={s.estAviso}>
                No pudimos leer tu tamizaje de salud, así que esta lista es la más conservadora.
              </Text>
            )}
            {estiramientos.map((e) => (
              <View key={e.nombre} style={s.estItem} accessible
                accessibilityLabel={`${e.nombre}, ${e.duracion}. ${e.como}`}>
                <Text style={s.estNombre}>{e.nombre}</Text>
                <Text style={s.estDur}>{e.duracion}</Text>
                <Text style={s.estComo}>{e.como}</Text>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity style={s.shareBtn} onPress={share} activeOpacity={0.85}
          accessibilityRole="button" accessibilityLabel="Compartir mi entrenamiento">
          <Text style={s.shareTxt}>📤  COMPARTIR</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.doneBtn}
          onPress={() => router.replace('/(tabs)' as any)}
          activeOpacity={0.85}
          accessibilityRole="button" accessibilityLabel="Ver mi progreso"
        >
          <Text style={s.doneTxt}>VER MI PROGRESO →</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  // ── Vuelta a la calma ──
  estWrap: {
    backgroundColor: Colors.bgCard, borderRadius: Radii.lg,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, marginTop: Spacing.md, marginBottom: Spacing.sm, width: '100%',
  },
  estTitulo: { fontFamily: Fonts.heading, fontSize: Type.bodyLg, color: Colors.textPrimary, letterSpacing: 0.6 },
  estIntro: { fontFamily: Fonts.body, fontSize: Type.body, color: Colors.textSecondary, lineHeight: 19, marginTop: 4, marginBottom: Spacing.sm },
  estAviso: { fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.warning, lineHeight: 17, marginBottom: Spacing.sm },
  estItem: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm, marginTop: Spacing.sm },
  estNombre: { fontFamily: Fonts.bodySemi, fontSize: Type.body, color: Colors.textPrimary },
  estDur: { fontFamily: Fonts.bodyMedium, fontSize: Type.caption, color: Colors.accent, marginTop: 1 },
  estComo: { fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.textSecondary, lineHeight: 17, marginTop: 3 },
  scroll: { padding: Spacing.xl, alignItems: 'center', paddingTop: 40 },
  trophy: { fontSize: 80, marginBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 40, color: Colors.textPrimary, textAlign: 'center', lineHeight: 42, marginBottom: Spacing.xl },
  statsRow: { flexDirection: 'row', gap: 10, width: '100%', marginBottom: 12 },
  statCell: { flex: 1, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.lg, padding: Spacing.md, alignItems: 'center' },
  statVal: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.textPrimary },
  statLbl: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, marginTop: 2 },
  streakCard: { flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%', backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.lg, padding: Spacing.md, marginBottom: 12 },
  streakTxt: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.textPrimary },
  freezeTxt: { fontFamily: Fonts.body, fontSize: 12, color: Colors.macroCarbs, marginTop: 2 },
  prCard: { width: '100%', backgroundColor: Colors.bgSelected, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.xl, padding: Spacing.lg, alignItems: 'center', marginBottom: 12 },
  prTitle: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.accent, marginBottom: 6 },
  prItem: { fontFamily: Fonts.bodyMedium, fontSize: 15, color: Colors.textPrimary },
  badgeRow: { width: '100%', backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.md, padding: 12, marginBottom: 8, alignItems: 'center' },
  badgeTxt: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.accent },
  shareBtn: { width: '100%', borderWidth: 1, borderColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 15, alignItems: 'center', marginTop: Spacing.lg },
  shareTxt: { fontFamily: Fonts.heading, fontSize: 16, color: Colors.accent, letterSpacing: 0.8 },
  doneBtn: { width: '100%', backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 18, alignItems: 'center', marginTop: 10 },
  doneTxt: { fontFamily: Fonts.heading, fontSize: 18, color: '#0a0a0b', letterSpacing: 0.8 },
});
