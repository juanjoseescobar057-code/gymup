// Components/HealthForm.tsx
// ─────────────────────────────────────────────────────────
// Formulario de tamizaje de salud (estilo PAR-Q+): banderas rojas,
// condiciones, lesiones activas y autorización médica. Reusado por el
// onboarding (paso Salud) y por Perfil → Salud.
// ─────────────────────────────────────────────────────────

import { View, Text, TouchableOpacity, TextInput, StyleSheet, Switch, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  INJURY_ZONES, CONDITIONS, computeRisk,
  type HealthProfile, type Condition, type InjuryZone,
} from '../lib/healthMath';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';

const PARQ_QUESTIONS: { key: 'parq_chest_pain' | 'parq_dizziness' | 'parq_doctor_restricted'; label: string }[] = [
  { key: 'parq_chest_pain', label: '¿Sientes dolor u opresión en el pecho al hacer ejercicio (o en reposo)?' },
  { key: 'parq_dizziness', label: '¿Has tenido mareos, desmayos o pérdida de equilibrio recientemente?' },
  { key: 'parq_doctor_restricted', label: '¿Un médico te ha dicho que solo hagas ejercicio supervisado?' },
];

export default function HealthForm({
  value,
  onChange,
  age,
}: {
  value: HealthProfile;
  onChange: (h: HealthProfile) => void;
  age: number;
}) {
  const risk = computeRisk(value, age);

  function toggleCondition(id: Condition) {
    Haptics.selectionAsync();
    const has = value.conditions.includes(id);
    onChange({
      ...value,
      conditions: has ? value.conditions.filter((c) => c !== id) : [...value.conditions, id],
    });
  }

  function toggleInjury(id: InjuryZone) {
    Haptics.selectionAsync();
    const has = value.injuries.includes(id);
    onChange({
      ...value,
      injuries: has ? value.injuries.filter((z) => z !== id) : [...value.injuries, id],
    });
  }

  return (
    <View>
      {/* Banderas rojas (PAR-Q) */}
      <Text style={s.secLbl}>ANTES DE ENTRENAR, CUÉNTANOS</Text>
      {PARQ_QUESTIONS.map((q) => (
        <View key={q.key} style={s.parqRow}>
          <Text style={s.parqTxt}>{q.label}</Text>
          <Switch
            value={value[q.key]}
            onValueChange={(v) => onChange({ ...value, [q.key]: v })}
            trackColor={{ false: Colors.border, true: Colors.warning }}
            thumbColor={Colors.textPrimary}
          />
        </View>
      ))}

      {/* Condiciones */}
      <Text style={[s.secLbl, { marginTop: Spacing.md }]}>¿TIENES ALGUNA DE ESTAS CONDICIONES?</Text>
      <View style={s.chipWrap}>
        {CONDITIONS.map((c) => {
          const sel = value.conditions.includes(c.id);
          return (
            <TouchableOpacity
              key={c.id}
              style={[s.chip, sel && s.chipSel]}
              onPress={() => toggleCondition(c.id)}
              activeOpacity={0.8}
            >
              <Text style={[s.chipTxt, sel && s.chipTxtSel]}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Lesiones activas */}
      <Text style={[s.secLbl, { marginTop: Spacing.md }]}>¿ALGUNA ZONA TE DUELE O ESTÁ LESIONADA HOY?</Text>
      <View style={s.chipWrap}>
        {INJURY_ZONES.map((z) => {
          const sel = value.injuries.includes(z.id);
          return (
            <TouchableOpacity
              key={z.id}
              style={[s.chip, sel && s.chipSelWarn]}
              onPress={() => toggleInjury(z.id)}
              activeOpacity={0.8}
            >
              <Text style={[s.chipTxt, sel && { color: Colors.warning }]}>{z.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Otra condición */}
      <TextInput
        style={s.noteInput}
        value={value.other_note ?? ''}
        onChangeText={(t) => onChange({ ...value, other_note: t })}
        placeholder="¿Algo más que tu coach deba saber? (opcional)"
        placeholderTextColor={Colors.textMuted}
        maxLength={200}
      />

      {/* Aviso según riesgo + autorización médica */}
      {risk.level === 'alto' && (
        <View style={s.riskCard}>
          <Text style={s.riskTitle}>🩺 Tu seguridad primero</Text>
          <Text style={s.riskTxt}>
            Por lo que marcaste ({risk.reasons.join(', ')}), necesitas el visto bueno de un
            médico antes de entrenar en serio. Mientras tanto tu plan será suave (caminatas y
            movilidad) y tu coach lo sabrá.
          </Text>
          <TouchableOpacity
            style={s.clearRow}
            onPress={() => {
              Haptics.selectionAsync();
              if (value.doctor_cleared) {
                onChange({ ...value, doctor_cleared: false });
                return;
              }
              // Confirmación de dos pasos: la autorización es una declaración
              // seria, no un checkbox al pasar.
              Alert.alert(
                'Confirmar autorización médica',
                `¿Confirmas que un médico te evaluó DESPUÉS de conocer esto (${risk.reasons.join(', ')}) y te autorizó a hacer ejercicio?\n\nMarcar esto sin ser cierto pone en riesgo tu salud.`,
                [
                  { text: 'No, todavía no', style: 'cancel' },
                  {
                    text: 'Sí, confirmo',
                    onPress: () => onChange({ ...value, doctor_cleared: true }),
                  },
                ]
              );
            }}
            activeOpacity={0.8}
          >
            <View style={[s.checkbox, value.doctor_cleared && s.checkboxOn]}>
              {value.doctor_cleared && <Text style={s.checkboxTick}>✓</Text>}
            </View>
            <Text style={s.clearTxt}>
              Mi médico ya me evaluó y me autorizó a hacer ejercicio
            </Text>
          </TouchableOpacity>
        </View>
      )}
      {risk.level === 'moderado' && (
        <View style={[s.riskCard, { borderColor: Colors.accentBorder, backgroundColor: Colors.bgSelected }]}>
          <Text style={[s.riskTitle, { color: Colors.accent }]}>✓ Tu plan se adaptará a esto</Text>
          <Text style={s.riskTxt}>
            Tu coach y tu plan tendrán en cuenta {risk.reasons.join(', ')} en cada
            recomendación. Si algo cambia, actualízalo en Perfil → Salud.
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  secLbl: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  parqRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.md, padding: Spacing.md, marginBottom: 8 },
  parqTxt: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.textPrimary, lineHeight: 19 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.full, paddingHorizontal: 14, paddingVertical: 9 },
  chipSel: { backgroundColor: Colors.bgSelected, borderColor: Colors.accent },
  chipSelWarn: { backgroundColor: 'rgba(255,157,58,0.1)', borderColor: Colors.warning },
  chipTxt: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.textSecondary },
  chipTxtSel: { color: Colors.accent },
  noteInput: { backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.md, paddingHorizontal: Spacing.md, paddingVertical: 12, fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, marginTop: Spacing.md },
  riskCard: { borderWidth: 1, borderColor: 'rgba(255,157,58,0.35)', backgroundColor: 'rgba(255,157,58,0.08)', borderRadius: Radii.lg, padding: Spacing.md, marginTop: Spacing.md },
  riskTitle: { fontFamily: Fonts.headingSemi, fontSize: 16, color: Colors.warning, marginBottom: 6 },
  riskTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  clearRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  checkboxTick: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#0a0a0b' },
  clearTxt: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.textPrimary, lineHeight: 19 },
});
