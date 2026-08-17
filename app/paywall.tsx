// app/paywall.tsx
// Pantalla de suscripción Premium. La compra real se conecta con RevenueCat.
import { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { PLANS, PREMIUM_BENEFITS, FREE_HIGHLIGHTS } from '../lib/subscription';
import { purchasePlan, restorePurchases, checkPremium } from '../lib/purchases';
import { track } from '../lib/analytics';
import { Colors, Fonts, Radii, Spacing, A11y, Type } from '../constants/theme';

type PlanKey = 'monthly' | 'yearly';
// Precio tal como lo devuelve la tienda: `texto` ya viene formateado en la
// moneda y el formato del usuario ("$36.900" en CO, "9,99 €" en ES).
type PrecioTienda = { texto: string; valor: number };

// Carga perezosa del SDK nativo, mismo criterio que lib/purchases.ts: si el
// módulo no está en esta build, el paywall sigue funcionando con el respaldo.
function rc(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-purchases').default;
  } catch {
    return null;
  }
}

// Mismo criterio de coincidencia que purchasePlan: exacta o con el separador
// ':' de Play Billing (base plan id), nunca un startsWith desnudo.
function esElPlan(identifier: string, planId: string): boolean {
  return identifier === planId || identifier.startsWith(`${planId}:`);
}

export default function PaywallScreen() {
  const [plan, setPlan] = useState<PlanKey>('yearly');
  const [busy, setBusy] = useState(false);
  const [precios, setPrecios] = useState<Partial<Record<PlanKey, PrecioTienda>>>({});
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

  // PRECIO REAL, no el de la lista de precios de EE. UU. Los de PLANS están en
  // USD fijos, pero la tienda cobra en la moneda del país (COP, MXN, EUR…) con
  // su propio redondeo: enseñar "$9.99" a alguien en Colombia es anunciar un
  // precio que nadie le va a cobrar. RevenueCat ya trae el precio formateado,
  // así que ese manda y el de PLANS queda solo como respaldo mientras carga.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const P = rc();
      if (!P) return; // build sin el módulo nativo: se queda el respaldo
      try {
        // checkPremium() configura el SDK con la identidad del usuario de forma
        // idempotente (lib/purchases no expone ensureConfigured). Sin eso,
        // getOfferings lanza si se llega al paywall antes de que la Home haya
        // sincronizado el entitlement.
        await checkPremium();
        const paquetes = (await P.getOfferings())?.current?.availablePackages ?? [];
        const encontrados: Partial<Record<PlanKey, PrecioTienda>> = {};
        (['monthly', 'yearly'] as PlanKey[]).forEach((k) => {
          const prod = paquetes.find((p: any) => esElPlan(p?.product?.identifier ?? '', PLANS[k].id))?.product;
          if (prod?.priceString) encontrados[k] = { texto: prod.priceString, valor: Number(prod.price) };
        });
        if (vivo && Object.keys(encontrados).length > 0) setPrecios(encontrados);
      } catch {
        // Sin red, sin ofertas configuradas o SDK sin inicializar: el paywall no
        // se bloquea por esto, muestra el respaldo marcado como aproximado.
      }
    })();
    return () => { vivo = false; };
  }, []);

  // El "ahorra 33%" salía de dividir los dos precios USD hardcodeados. Con
  // precios de tienda la proporción puede ser otra (cada país redondea a su
  // manera), así que si tenemos los dos reales el ahorro se recalcula, y si el
  // anual no sale a cuenta simplemente no se anuncia ahorro.
  const ahorroAnual = useMemo(() => {
    const mensual = precios.monthly?.valor;
    const anual = precios.yearly?.valor;
    if (!mensual || !anual || mensual <= 0 || anual <= 0) return PLANS.yearly.save;
    const pct = Math.round((1 - anual / (mensual * 12)) * 100);
    return pct > 0 ? `${pct}%` : null;
  }, [precios]);

  // Mientras no haya precio de tienda se marca como aproximado: es un respaldo
  // visual, no una oferta.
  const etiquetaPrecio = (k: PlanKey) =>
    precios[k]?.texto ?? `≈ ${PLANS[k].price} USD`;

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
    // El pago se hizo, pero el servidor aún no confirmó el acceso. Decirlo
    // ahora evita que la persona abra una función Premium y reciba un 402
    // justo después de pagar, sin entender por qué.
    if (res.pendiente) {
      Alert.alert('Pago recibido', res.error ?? 'Estamos activando tu Premium.');
    }
    router.back();
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.nav}>
        <TouchableOpacity style={s.close} onPress={() => router.back()} hitSlop={A11y.hitSlopLg}
          accessibilityRole="button" accessibilityLabel="Cerrar y volver">
          <Text style={s.closeTxt}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
        <Text style={s.title} accessibilityRole="header">GymUp <Text style={{ color: Colors.accent }}>Premium</Text></Text>
        <Text style={s.sub}>Lo que Premium añade a lo que ya tienes. Estos son los cupos diarios reales.</Text>

        <View style={s.benefits}>
          {PREMIUM_BENEFITS.map((b, i) => (
            <Text key={i} style={s.benefit}>{b}</Text>
          ))}
        </View>

        {/* Qué conserva si NO paga. Enseñarlo parece ir contra la conversión y
            es al revés: sin esto, el paywall se lee como "la app no sirve sin
            pagar", y de ahí se sale desinstalando, no comprando. Todo lo de esta
            lista es determinista y no cuesta un token, así que se puede
            prometer sin letra pequeña. */}
        <View style={s.freeBox}>
          <Text style={s.freeTitle}>Esto es tuyo sin pagar nada</Text>
          {FREE_HIGHLIGHTS.map((b, i) => (
            <Text key={i} style={s.freeItem}>{b}</Text>
          ))}
        </View>

        <TouchableOpacity
          style={[s.planCard, plan === 'yearly' && s.planSel]}
          onPress={() => setPlan('yearly')}
          activeOpacity={0.85}
          accessibilityRole="radio"
          accessibilityLabel={
            `Plan anual: ${etiquetaPrecio('yearly')} por ${PLANS.yearly.period}` +
            (ahorroAnual ? `, ahorras ${ahorroAnual}` : '')
          }
          accessibilityState={{ selected: plan === 'yearly' }}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.planName}>Anual</Text>
            <Text style={s.planMeta}>
              {etiquetaPrecio('yearly')}/{PLANS.yearly.period}{ahorroAnual ? ` · ahorra ${ahorroAnual}` : ''}
            </Text>
          </View>
          <View style={[s.radio, plan === 'yearly' && s.radioOn]} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.planCard, plan === 'monthly' && s.planSel]}
          onPress={() => setPlan('monthly')}
          activeOpacity={0.85}
          accessibilityRole="radio"
          accessibilityLabel={`Plan mensual: ${etiquetaPrecio('monthly')} por ${PLANS.monthly.period}`}
          accessibilityState={{ selected: plan === 'monthly' }}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.planName}>Mensual</Text>
            <Text style={s.planMeta}>{etiquetaPrecio('monthly')}/{PLANS.monthly.period}</Text>
          </View>
          <View style={[s.radio, plan === 'monthly' && s.radioOn]} />
        </TouchableOpacity>

        <TouchableOpacity style={[s.cta, busy && { opacity: 0.6 }]} onPress={subscribe} disabled={busy} activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={busy
            ? 'Procesando tu suscripción, espera'
            : `Empezar Premium con el plan ${plan === 'yearly' ? 'anual' : 'mensual'}`}
          accessibilityState={{ disabled: busy, busy }}>
          <Text style={s.ctaTxt}>{busy ? 'Procesando…' : 'EMPEZAR PREMIUM'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button" accessibilityLabel="Restaurar compras anteriores"
          onPress={async () => { const r = await restorePurchases(); Alert.alert('Restaurar', r.ok ? 'Listo' : (r.error ?? '')); }}>
          <Text style={s.restore}>Restaurar compras</Text>
        </TouchableOpacity>

        <Text style={s.legal}>
          El precio mostrado es el de la tienda en tu moneda; si aparece con «≈» todavía lo estamos consultando y es solo orientativo. Las funciones con IA tienen los cupos diarios indicados arriba. La suscripción se renueva automáticamente salvo que la canceles al menos 24h antes del fin del periodo. Puedes gestionarla en la tienda.
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 10 }}>
          <TouchableOpacity onPress={() => router.push('/legal?doc=terms' as any)} accessibilityRole="link" accessibilityLabel="Leer términos de uso">
            <Text style={s.legalLink}>Términos</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/legal?doc=privacy' as any)} accessibilityRole="link" accessibilityLabel="Leer política de privacidad">
            <Text style={s.legalLink}>Privacidad</Text>
          </TouchableOpacity>
        </View>
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
  // La caja de lo gratuito va deliberadamente en segundo plano: informa sin
  // competir con lo que se está vendiendo. Aun así respeta el piso legible de
  // 13px y el contraste AA de Colors.textSecondary (ver __tests__/contrast).
  freeBox: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: 6,
  },
  freeTitle: { fontFamily: Fonts.headingSemi, fontSize: 15, color: Colors.textSecondary, marginBottom: 2 },
  freeItem: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary },
  planCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1.5, borderColor: Colors.border, padding: Spacing.md, marginBottom: 10 },
  planSel: { borderColor: Colors.accent, backgroundColor: Colors.bgSelected },
  planName: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.textPrimary },
  planMeta: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border },
  radioOn: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  cta: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 18, alignItems: 'center', marginTop: Spacing.lg },
  ctaTxt: { fontFamily: Fonts.heading, fontSize: 20, color: '#0a0a0b', letterSpacing: 1 },
  restore: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.lg, textDecorationLine: 'underline' },
  legal: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.lg, lineHeight: 15 },
  legalLink: { fontFamily: Fonts.bodySemi, fontSize: Type.caption, color: Colors.accent, textDecorationLine: 'underline' },
});
