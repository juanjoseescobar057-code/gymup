// app/workout-complete.tsx
// ─────────────────────────────────────────────────────────
// Celebración post-entrenamiento: reemplaza el Alert plano con una
// pantalla real (duración, XP, racha, PRs, badges) + compartir.
// ─────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Share, Animated,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { track } from '../lib/analytics';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';

export default function WorkoutCompleteScreen() {
  const p = useLocalSearchParams<{
    duration?: string; exercises?: string; xp?: string; streak?: string;
    leveledUp?: string; badges?: string; prs?: string; freezeUsed?: string;
  }>();

  const duration = String(p.duration ?? '0:00');
  const exercises = String(p.exercises ?? '0');
  const xp = String(p.xp ?? '0');
  const streak = String(p.streak ?? '0');
  const leveledUp = p.leveledUp === '1';
  const freezeUsed = p.freezeUsed === '1';
  const badges = p.badges ? String(p.badges).split('|').filter(Boolean) : [];
  const prs = p.prs ? String(p.prs).split('|').filter(Boolean) : [];

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
        <Animated.Text style={[s.trophy, { transform: [{ scale }] }]}>🏆</Animated.Text>
        <Text style={s.title}>¡ENTRENAMIENTO{'\n'}COMPLETADO!</Text>

        {/* Stats principales */}
        <View style={s.statsRow}>
          <View style={s.statCell}>
            <Text style={s.statVal}>{duration}</Text>
            <Text style={s.statLbl}>Duración</Text>
          </View>
          <View style={s.statCell}>
            <Text style={s.statVal}>{exercises}</Text>
            <Text style={s.statLbl}>Ejercicios</Text>
          </View>
          <View style={s.statCell}>
            <Text style={[s.statVal, { color: Colors.accent }]}>+{xp}</Text>
            <Text style={s.statLbl}>XP</Text>
          </View>
        </View>

        {/* Racha */}
        <View style={s.streakCard}>
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
          <View style={s.prCard}>
            <Text style={s.prTitle}>🏅 ¡RÉCORD PERSONAL!</Text>
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

        <TouchableOpacity style={s.shareBtn} onPress={share} activeOpacity={0.85} accessibilityLabel="Compartir entrenamiento">
          <Text style={s.shareTxt}>📤  COMPARTIR</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.doneBtn}
          onPress={() => router.replace('/(tabs)' as any)}
          activeOpacity={0.85}
        >
          <Text style={s.doneTxt}>VER MI PROGRESO →</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: Spacing.xl, alignItems: 'center', paddingTop: 40 },
  trophy: { fontSize: 80, marginBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 40, color: Colors.textPrimary, textAlign: 'center', lineHeight: 42, marginBottom: Spacing.xl },
  statsRow: { flexDirection: 'row', gap: 10, width: '100%', marginBottom: 12 },
  statCell: { flex: 1, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.lg, padding: Spacing.md, alignItems: 'center' },
  statVal: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.textPrimary },
  statLbl: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, marginTop: 2 },
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
