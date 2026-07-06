// app/paywall.tsx
// Pantalla de suscripción Premium. La compra real se conecta con RevenueCat.
import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { PLANS, PREMIUM_BENEFITS } from '../lib/subscription';
import { purchasePlan, restorePurchases } from '../lib/purchases';
import { track } from '../lib/analytics';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';

export default function PaywallScreen() {
  const [plan, setPlan] = useState<'monthly' | 'yearly'>('yearly');
  const [busy, setBusy] = useState(false);
  const purchasedRef = useRef(false);

  // Monetización: ver el paywall, y CUÁNTO dudó antes de cerrarlo sin comprar
  // (el dwell del paywall es de las señales de pricing más valiosas).
  useEffect(() => {
    track('paywall_viewed');
    const openedAt = Date.now();
    return () => {
      if (!purchasedRef.current) {
        track('paywall_dismissed', { seconds_open: Math.round((Date.now() - openedAt) / 1000) });
      }
    };
  }, []);

  async function subscribe() {
    setBusy(true);
    track('purchase_started', { plan });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const res = await purchasePlan(PLANS[plan].id);
    setBusy(false);
    if (!res.ok) { Alert.alert('Premium', res.error ?? 'No disponible.'); return; }
    purchasedRef.current = true;
    track('purchase_completed', { plan });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.nav}>
        <TouchableOpacity style={s.close} onPress={() => router.back()} accessibilityLabel="Cerrar">
          <Text style={s.closeTxt}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
        <Text style={s.title}>GymUp <Text style={{ color: Colors.accent }}>Premium</Text></Text>
        <Text style={s.sub}>Desbloquea todo tu potencial. Sin límites.</Text>

        <View style={s.benefits}>
          {PREMIUM_BENEFITS.map((b, i) => (
            <Text key={i} style={s.benefit}>{b}</Text>
          ))}
        </View>

        <TouchableOpacity
          style={[s.planCard, plan === 'yearly' && s.planSel]}
          onPress={() => setPlan('yearly')}
          activeOpacity={0.85}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.planName}>Anual</Text>
            <Text style={s.planMeta}>{PLANS.yearly.price}/{PLANS.yearly.period} · ahorra {PLANS.yearly.save}</Text>
          </View>
          <View style={[s.radio, plan === 'yearly' && s.radioOn]} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.planCard, plan === 'monthly' && s.planSel]}
          onPress={() => setPlan('monthly')}
          activeOpacity={0.85}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.planName}>Mensual</Text>
            <Text style={s.planMeta}>{PLANS.monthly.price}/{PLANS.monthly.period}</Text>
          </View>
          <View style={[s.radio, plan === 'monthly' && s.radioOn]} />
        </TouchableOpacity>

        <TouchableOpacity style={[s.cta, busy && { opacity: 0.6 }]} onPress={subscribe} disabled={busy} activeOpacity={0.85}>
          <Text style={s.ctaTxt}>{busy ? 'Procesando…' : 'EMPEZAR PREMIUM'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={async () => { const r = await restorePurchases(); Alert.alert('Restaurar', r.ok ? 'Listo' : (r.error ?? '')); }}>
          <Text style={s.restore}>Restaurar compras</Text>
        </TouchableOpacity>

        <Text style={s.legal}>
          La suscripción se renueva automáticamente salvo que la canceles al menos 24h antes del fin del periodo. Puedes gestionarla en la tienda.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  nav: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  close: { width: 40, height: 40, backgroundColor: Colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  closeTxt: { fontFamily: Fonts.headingBold, fontSize: 16, color: Colors.textMuted },
  title: { fontFamily: Fonts.heading, fontSize: 44, color: Colors.textPrimary, marginTop: Spacing.md },
  sub: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textSecondary, marginBottom: Spacing.xl },
  benefits: { backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, gap: 12, marginBottom: Spacing.xl },
  benefit: { fontFamily: Fonts.bodyMedium, fontSize: 15, color: Colors.textPrimary },
  planCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1.5, borderColor: Colors.border, padding: Spacing.md, marginBottom: 10 },
  planSel: { borderColor: Colors.accent, backgroundColor: Colors.bgSelected },
  planName: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.textPrimary },
  planMeta: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border },
  radioOn: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  cta: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 18, alignItems: 'center', marginTop: Spacing.lg },
  ctaTxt: { fontFamily: Fonts.heading, fontSize: 20, color: '#0a0a0b', letterSpacing: 1 },
  restore: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.lg, textDecorationLine: 'underline' },
  legal: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.lg, lineHeight: 15 },
});
