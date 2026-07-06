// app/history.tsx
// Historial: récords personales por ejercicio + sesiones recientes.
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUserStore } from '../store/userStore';
import { fetchRecentSessions, fetchExerciseRecords, type SessionRow, type ExerciseRecord } from '../lib/history';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';

export default function HistoryScreen() {
  const profile = useUserStore((s: any) => s.profile);
  const [records, setRecords] = useState<ExerciseRecord[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) {
      // Sin perfil (deep link / arranque frío) no dejar el spinner infinito.
      setLoading(false);
      return;
    }
    Promise.all([fetchExerciseRecords(profile.user_id), fetchRecentSessions(profile.user_id)])
      .then(([r, s]) => { setRecords(r); setSessions(s); })
      .finally(() => setLoading(false));
  }, [profile?.user_id]);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.nav}>
        <TouchableOpacity style={s.back} onPress={() => router.back()} accessibilityLabel="Volver">
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.navTitle}>HISTORIAL</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
          {/* Récords */}
          <Text style={s.sectionLbl}>🏆 TUS RÉCORDS</Text>
          {records.length === 0 ? (
            <View style={s.empty}>
              <Text style={{ fontSize: 32, marginBottom: 8 }}>💪</Text>
              <Text style={s.emptyTxt}>Registra el peso y reps de tus series para ver tus récords aquí.</Text>
            </View>
          ) : (
            records.map((r) => (
              <View key={r.exercise_name} style={s.recordCard}>
                <Text style={s.recordName}>{r.exercise_name}</Text>
                <View style={s.recordRow}>
                  <View style={s.recordCell}>
                    <Text style={s.recordVal}>{r.best1RM}<Text style={s.recordUnit}> kg</Text></Text>
                    <Text style={s.recordCellLbl}>1RM est.</Text>
                  </View>
                  <View style={s.recordCell}>
                    <Text style={s.recordVal}>{r.maxWeight}<Text style={s.recordUnit}> kg</Text></Text>
                    <Text style={s.recordCellLbl}>Máx peso</Text>
                  </View>
                  <View style={s.recordCell}>
                    <Text style={s.recordVal}>{r.maxReps}</Text>
                    <Text style={s.recordCellLbl}>Máx reps</Text>
                  </View>
                </View>
              </View>
            ))
          )}

          {/* Sesiones */}
          <Text style={[s.sectionLbl, { marginTop: Spacing.lg }]}>📅 SESIONES RECIENTES</Text>
          {sessions.length === 0 ? (
            <Text style={s.emptyTxt}>Aún no has completado entrenamientos.</Text>
          ) : (
            sessions.map((ss) => (
              <View key={ss.id} style={s.sessionRow}>
                <View style={s.sessionDate}>
                  <Text style={s.sessionDateTxt}>
                    {ss.completed_at ? new Date(ss.completed_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '—'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.sessionTitle}>Día {(ss.day_index ?? 0) + 1} · {ss.exercises_completed ?? 0} ejercicios</Text>
                  <Text style={s.sessionMeta}>{ss.duration_min ?? 0} min</Text>
                </View>
              </View>
            ))
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  back: { width: 40, height: 40, backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  backTxt: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary },
  navTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.textPrimary, letterSpacing: 0.8 },
  sectionLbl: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  empty: { alignItems: 'center', padding: Spacing.xl, backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border },
  emptyTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 19 },
  recordCard: { backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 8 },
  recordName: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.textPrimary, marginBottom: 8 },
  recordRow: { flexDirection: 'row', gap: 8 },
  recordCell: { flex: 1, alignItems: 'center' },
  recordVal: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.accent },
  recordUnit: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  recordCellLbl: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.bgCard, borderRadius: Radii.md, borderWidth: 1, borderColor: Colors.border, padding: 12, marginBottom: 6 },
  sessionDate: { width: 54, height: 40, borderRadius: Radii.sm, backgroundColor: Colors.bgInput, alignItems: 'center', justifyContent: 'center' },
  sessionDateTxt: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.accent, textAlign: 'center' },
  sessionTitle: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textPrimary },
  sessionMeta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 2 },
});
