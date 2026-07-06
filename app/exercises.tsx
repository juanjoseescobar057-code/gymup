// app/exercises.tsx
// Biblioteca de ejercicios: explorar por grupo muscular + ver instrucciones.
import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EXERCISE_LIBRARY, MUSCLE_GROUPS, type LibraryExercise } from '../constants/exercises';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';

export default function ExercisesScreen() {
  const [filter, setFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<LibraryExercise | null>(null);

  const list = filter ? EXERCISE_LIBRARY.filter((e) => e.muscle_group === filter) : EXERCISE_LIBRARY;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.nav}>
        <TouchableOpacity style={s.back} onPress={() => router.back()} accessibilityLabel="Volver">
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.navTitle}>EJERCICIOS</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: Spacing.lg, gap: 8, paddingBottom: 4 }}
        style={{ maxHeight: 48 }}>
        <Chip label="Todos" active={filter === null} onPress={() => setFilter(null)} />
        {MUSCLE_GROUPS.map((g) => (
          <Chip key={g} label={g} active={filter === g} onPress={() => setFilter(g)} />
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg, gap: 8 }}>
        {list.map((e) => (
          <TouchableOpacity key={e.id} style={s.row} onPress={() => setSelected(e)} activeOpacity={0.8}>
            <Text style={{ fontSize: 26 }}>{e.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.rowName}>{e.name}</Text>
              <Text style={s.rowMeta}>{e.muscle_group} · {e.equipment}</Text>
            </View>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            {selected && (
              <>
                <Text style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>{selected.emoji}</Text>
                <Text style={s.sheetTitle}>{selected.name}</Text>
                <Text style={s.sheetMeta}>{selected.muscle_group} · {selected.equipment}</Text>
                {selected.instructions.map((step, i) => (
                  <View key={i} style={s.stepRow}>
                    <Text style={s.stepNum}>{i + 1}</Text>
                    <Text style={s.stepTxt}>{step}</Text>
                  </View>
                ))}
                <TouchableOpacity style={s.closeBtn} onPress={() => setSelected(null)}>
                  <Text style={s.closeTxt}>Cerrar</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip, active && s.chipActive]} activeOpacity={0.8}>
      <Text style={[s.chipTxt, active && { color: '#0a0a0b' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  back: { width: 40, height: 40, backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  backTxt: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary },
  navTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.textPrimary, letterSpacing: 0.8 },
  chip: { borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: Colors.bgCard, height: 34 },
  chipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  chipTxt: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md },
  rowName: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.textPrimary },
  rowMeta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  chevron: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.textMuted },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.bgCard, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: Spacing.xl, borderTopWidth: 1, borderTopColor: Colors.border },
  sheetTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.textPrimary, textAlign: 'center' },
  sheetMeta: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginBottom: Spacing.lg },
  stepRow: { flexDirection: 'row', gap: 10, marginBottom: 10, alignItems: 'flex-start' },
  stepNum: { fontFamily: Fonts.heading, fontSize: 14, color: '#0a0a0b', backgroundColor: Colors.accent, width: 22, height: 22, borderRadius: 11, textAlign: 'center', lineHeight: 22, overflow: 'hidden' },
  stepTxt: { flex: 1, fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  closeBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 16, alignItems: 'center', marginTop: Spacing.md },
  closeTxt: { fontFamily: Fonts.heading, fontSize: 16, color: '#0a0a0b', letterSpacing: 0.8 },
});
