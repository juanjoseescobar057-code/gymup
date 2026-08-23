// Components/AvisoReconsentimiento.tsx
// ─────────────────────────────────────────────────────────
// Volver a pedir la autorización cuando cambian los documentos.
//
// El registro de consentimientos guarda una fila por documento Y VERSIÓN, y
// lib/legal.ts sabe calcular qué le falta a cada persona. Eso se construyó
// entero y NO LO LLAMABA NADIE: quien se registró con la política 1.3 seguiría
// dentro con la 1.9 sin haberla visto nunca, y en el registro constaría que
// aceptó la 1.3 — que es cierto, y por eso mismo no sirve para la 1.9.
//
// El versionado sin reconsentimiento es un campo de más en una tabla.
//
// CÓMO INTERRUMPE. Lo mínimo. Un muro a pantalla completa al abrir la app, por
// un cambio de redacción en unos términos, es desproporcionado y la gente lo
// acepta sin leer solo para quitárselo de encima — que es exactamente lo que
// invalida un consentimiento. Esto es una tarjeta en la portada: se ve, se
// puede leer el documento, y se acepta cuando la persona quiera.
//
// La excepción sería un cambio de versión MAYOR en el tratamiento de datos
// sensibles; eso sí justifica bloquear, y cuando toque se decide entonces con
// el documento delante.
// ─────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useUserStore } from '../store/userStore';
import { pendientesDeAceptar, registrarConsentimiento } from '../lib/consentimientos';
import { VERSIONES, type DocumentoLegal } from '../lib/legal';
import { Colors, Fonts, Radii, Spacing, Type } from '../constants/theme';

const NOMBRE: Record<DocumentoLegal, string> = {
  terms: 'los Términos de Uso',
  privacy: 'la Política de Privacidad',
};

export default function AvisoReconsentimiento() {
  const profile = useUserStore((s: any) => s.profile);
  const [pendientes, setPendientes] = useState<DocumentoLegal[]>([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!profile?.user_id) return;
    let vivo = true;
    // pendientesDeAceptar devuelve [] si no se pudo leer, no la lista entera:
    // no se le saca un muro legal a alguien porque su móvil no tenía cobertura.
    pendientesDeAceptar(profile.user_id)
      .then((p) => vivo && setPendientes(p))
      .catch(() => {});
    return () => { vivo = false; };
  }, [profile?.user_id]);

  if (pendientes.length === 0) return null;

  const lista = pendientes.map((d) => NOMBRE[d]).join(' y ');
  const versiones = pendientes.map((d) => `${NOMBRE[d]} v${VERSIONES[d]}`).join(', ');

  async function aceptar() {
    if (!profile?.user_id || guardando) return;
    setGuardando(true);
    const r = await registrarConsentimiento(profile.user_id);
    setGuardando(false);
    // Solo se quita si de verdad quedó constancia. Ocultar la tarjeta sin haber
    // guardado nada dejaría a la persona creyendo que aceptó y a nosotros sin
    // poder demostrarlo — las dos mitades del mismo error.
    if (r.ok) setPendientes([]);
  }

  return (
    <View style={s.card} accessible accessibilityLabel={`Actualizamos ${lista}. Revísalos y acéptalos.`}>
      <Text style={s.titulo}>📄 Actualizamos {lista}</Text>
      <Text style={s.texto}>
        Cambió lo que aceptaste al registrarte, así que necesitamos que lo veas otra vez.
        Puedes seguir usando la app mientras tanto.
      </Text>
      <Text style={s.detalle}>{versiones}</Text>
      <View style={s.fila}>
        <TouchableOpacity
          style={s.secundario}
          onPress={() => router.push(`/legal?doc=${pendientes[0] === 'terms' ? 'terms' : 'privacy'}` as any)}
          accessibilityRole="button"
          accessibilityLabel="Leer el documento"
        >
          <Text style={s.secundarioTxt}>Leerlo</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btn, guardando && { opacity: 0.6 }]}
          onPress={aceptar}
          disabled={guardando}
          accessibilityRole="button"
          accessibilityLabel="Aceptar los documentos actualizados"
        >
          <Text style={s.btnTxt}>{guardando ? 'GUARDANDO…' : 'ACEPTO'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    gap: 8,
  },
  titulo: { fontFamily: Fonts.headingSemi, fontSize: 16, color: Colors.textPrimary },
  texto: { fontFamily: Fonts.body, fontSize: Type.body, lineHeight: 20, color: Colors.textSecondary },
  detalle: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted },
  fila: { flexDirection: 'row', gap: 10, marginTop: 6 },
  secundario: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.md,
  },
  secundarioTxt: { fontFamily: Fonts.bodySemi, fontSize: Type.body, color: Colors.textPrimary },
  btn: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    borderRadius: Radii.md,
  },
  btnTxt: { fontFamily: Fonts.heading, fontSize: Type.body, color: '#0a0a0b', letterSpacing: 0.5 },
});
