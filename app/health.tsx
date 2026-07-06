// app/health.tsx
// ─────────────────────────────────────────────────────────
// Editar el perfil de salud después del onboarding (las lesiones sanan,
// las condiciones cambian). Al guardar, se ofrece re-adaptar el plan para
// que las nuevas directivas apliquen de inmediato.
// ─────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useUserStore } from '../store/userStore';
import HealthForm from '../Components/HealthForm';
import { loadHealthSafe, saveHealthProfile, markPlanStaleForHealth, clearPlanStaleForHealth } from '../lib/health';
import { EMPTY_HEALTH, computeRisk, type HealthProfile } from '../lib/healthMath';
import { regenerateAdaptivePlan, saveAdaptedPlan } from '../lib/adaptivePlan';
import { track } from '../lib/analytics';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';

export default function HealthScreen() {
  const profile = useUserStore((s: any) => s.profile);
  const trainingPlan = useUserStore((s: any) => s.trainingPlan);
  const setTrainingPlan = useUserStore((s: any) => s.setTrainingPlan);
  const setProfile = useUserStore((s: any) => s.setProfile);

  const [health, setHealth] = useState<HealthProfile>(EMPTY_HEALTH);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  // FAIL-CLOSED: si no se puede cargar el perfil real, NO se muestra un
  // formulario vacío editable — guardarlo sobreescribiría las condiciones
  // reales del usuario con "sano" por un fallo técnico.
  function load() {
    if (!profile) return;
    setLoading(true);
    loadHealthSafe(profile.user_id)
      .then((res) => {
        if (res.status === 'unknown') {
          setLoadFailed(true);
        } else {
          setLoadFailed(false);
          if (res.profile) setHealth(res.profile);
        }
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }
  useEffect(load, [profile?.user_id]);

  async function save() {
    if (!profile || saving) return;
    setSaving(true);
    const res = await saveHealthProfile(profile.user_id, health, profile.age);
    setSaving(false);
    if (!res.ok) { Alert.alert('Error', res.error ?? 'No se pudo guardar.'); return; }

    const risk = computeRisk(health, profile.age);
    track('health_updated', {
      risk_level: risk.level,
      conditions: health.conditions.length,
      injuries: health.injuries.length,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // El plan actual se generó con la salud anterior: queda marcado como
    // OBSOLETO (persistente — un Alert efímero no basta) hasta re-adaptarlo.
    if (trainingPlan?.plan_data) {
      await markPlanStaleForHealth(profile.user_id);
      Alert.alert(
        '✅ Salud actualizada',
        '¿Quieres que la IA ajuste tu plan AHORA con esta información? (recomendado si agregaste una lesión o condición)',
        [
          { text: 'Después', style: 'cancel', onPress: () => router.back() },
          {
            text: 'Ajustar mi plan',
            onPress: async () => {
              try {
                setSaving(true);
                const newPlan = await regenerateAdaptivePlan(profile, trainingPlan.plan_data);
                const saved = await saveAdaptedPlan(profile.user_id, newPlan);
                if (saved) setTrainingPlan(saved);
                await clearPlanStaleForHealth(profile.user_id);
                setProfile({ ...profile, current_plan_day: 0 });
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert('💪 Plan ajustado', 'Tu plan ya respeta tus condiciones de salud.');
              } catch (e: any) {
                Alert.alert('No se pudo ajustar', e?.message ?? 'Intenta desde Perfil → Ajustar mi plan.');
              } finally {
                setSaving(false);
                router.back();
              }
            },
          },
        ]
      );
    } else {
      router.back();
    }
  }

  if (!profile || loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.nav}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backBtnTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.navTitle}>🩺 MI SALUD</Text>
        <View style={{ width: 40 }} />
      </View>

      {loadFailed ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl }}>
          <Text style={{ fontSize: 34, marginBottom: 12 }}>📡</Text>
          <Text style={{ fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.textPrimary, marginBottom: 8, textAlign: 'center' }}>
            No pudimos cargar tu perfil de salud
          </Text>
          <Text style={{ fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 20 }}>
            Por tu seguridad no editamos a ciegas: guardar un formulario vacío borraría tus
            condiciones reales. Revisa tu conexión e intenta de nuevo.
          </Text>
          <TouchableOpacity style={s.saveBtn} onPress={load} activeOpacity={0.85}>
            <Text style={s.saveBtnTxt}>REINTENTAR</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.intro}>
            Tu plan y tu coach se adaptan a esto en cada recomendación. Mantenlo al día: si una
            lesión sanó o apareció algo nuevo, cámbialo aquí.
          </Text>

          <HealthForm value={health} onChange={setHealth} age={profile.age} />

          <TouchableOpacity
            style={[s.saveBtn, saving && { opacity: 0.6 }]}
            onPress={save}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={s.saveBtnTxt}>{saving ? 'GUARDANDO…' : 'GUARDAR ✓'}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  backBtn: { width: 40, height: 40, backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  backBtnTxt: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary },
  navTitle: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary },
  intro: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.lg },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 16, alignItems: 'center', marginTop: Spacing.lg },
  saveBtnTxt: { fontFamily: Fonts.heading, fontSize: 18, color: '#0a0a0b', letterSpacing: 0.8 },
});
