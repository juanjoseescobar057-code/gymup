// Components/ReportContentButton.tsx
// ─────────────────────────────────────────────────────────
// Botón + hoja modal para reportar una respuesta de IA como incorrecta,
// dañina u ofensiva (política "AI-Generated Content" de Google Play).
// Autocontenido: cualquier pantalla lo suelta con feature+content y ya.
// ─────────────────────────────────────────────────────────

import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useUserStore } from '../store/userStore';
import { reportAIContent, AI_REPORT_REASONS, type AIReportFeature, type AIReportReason } from '../lib/aiReports';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';

type Props = {
  feature: AIReportFeature;
  /** Snapshot de lo que se está reportando (se trunca antes de guardar). */
  content?: string;
  /** "🚩 Reportar" por defecto; pasa texto propio si el espacio es reducido. */
  label?: string;
};

export default function ReportContentButton({ feature, content, label = '🚩 Reportar' }: Props) {
  const profile = useUserStore((s: any) => s.profile);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<AIReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  function close() {
    setOpen(false);
    setReason(null);
    setNote('');
    setSent(false);
  }

  async function submit() {
    if (!profile?.user_id || !reason) return;
    setBusy(true);
    try {
      const res = await reportAIContent({ userId: profile.user_id, feature, reason, note, content });
      if (!res.ok) {
        Alert.alert('No se pudo enviar', 'Intenta de nuevo en un momento.');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={s.trigger} activeOpacity={0.7}>
        <Text style={s.triggerTxt}>{label}</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            {sent ? (
              <>
                <Text style={s.title}>Gracias por avisarnos</Text>
                <Text style={s.subtitle}>Revisaremos este contenido. Tu reporte ayuda a mejorar la IA.</Text>
                <TouchableOpacity style={s.primaryBtn} onPress={close} activeOpacity={0.85}>
                  <Text style={s.primaryBtnTxt}>Cerrar</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.title}>Reportar este contenido</Text>
                <Text style={s.subtitle}>¿Qué anduvo mal con esta respuesta de la IA?</Text>

                {AI_REPORT_REASONS.map((r) => (
                  <TouchableOpacity
                    key={r.id}
                    style={[s.reasonRow, reason === r.id && s.reasonRowSel]}
                    onPress={() => { setReason(r.id); Haptics.selectionAsync(); }}
                    activeOpacity={0.8}>
                    <View style={[s.radio, reason === r.id && s.radioSel]}>
                      {reason === r.id && <View style={s.radioDot} />}
                    </View>
                    <Text style={s.reasonTxt}>{r.label}</Text>
                  </TouchableOpacity>
                ))}

                <TextInput
                  style={s.noteInput}
                  placeholder="Detalles adicionales (opcional)"
                  placeholderTextColor={Colors.textMuted}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  maxLength={500}
                />

                <TouchableOpacity
                  style={[s.primaryBtn, (!reason || busy) && { opacity: 0.4 }]}
                  disabled={!reason || busy}
                  onPress={submit}
                  activeOpacity={0.85}>
                  <Text style={s.primaryBtnTxt}>{busy ? 'Enviando...' : 'Enviar reporte'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.secondaryBtn} onPress={close} activeOpacity={0.85}>
                  <Text style={s.secondaryBtnTxt}>Cancelar</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  trigger: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 2 },
  triggerTxt: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, textDecorationLine: 'underline' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.bgCard, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: Spacing.xl },
  title: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary, marginBottom: 6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: Spacing.md, lineHeight: 19 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  reasonRowSel: { borderBottomColor: Colors.accentBorder },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  radioSel: { borderColor: Colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.accent },
  reasonTxt: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, flex: 1 },
  noteInput: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textPrimary, backgroundColor: Colors.bgInput, borderRadius: Radii.md, padding: 12, marginTop: Spacing.md, minHeight: 70, textAlignVertical: 'top' },
  primaryBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 16, alignItems: 'center', marginTop: Spacing.md },
  primaryBtnTxt: { fontFamily: Fonts.heading, fontSize: 15, color: '#0a0a0b', letterSpacing: 0.6 },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  secondaryBtnTxt: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.textMuted },
});
