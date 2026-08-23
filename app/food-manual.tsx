// app/food-manual.tsx
// ─────────────────────────────────────────────────────────
// Registrar una comida a mano, sin foto y sin IA.
//
// Hasta ahora la ÚNICA forma de registrar comida era escanearla, así que sin
// permiso de cámara, con el cupo diario agotado o simplemente con la etiqueta
// del paquete delante, el usuario no podía anotar lo que comió — y un día sin
// registrar rompe sus totales y su racha de macros por un problema que no es
// suyo.
//
// Ojo: esto NO es una vía offline. No usa IA, pero el insert sigue yendo al
// servidor, así que sin señal falla igual que el escaneo.
//
// Guarda por el mismo camino que el escaneo (lib/logMeal.ts): mismo insert,
// mismo XP, mismos avisos. No es una vía rápida ni un atajo.
// ─────────────────────────────────────────────────────────

import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useUserStore } from '../store/userStore';
import { registrarComida } from '../lib/logMeal';
import { validarComidaManual, caloriasDesdeMacros } from '../lib/mealMath';
import { Colors, Fonts, Radii, Spacing, Type, A11y } from '../constants/theme';
import GuardiaRecuperacion from '../Components/GuardiaRecuperacion';

/** '' → NaN a propósito: un campo vacío no es un cero, es un dato que falta. */
function aNumero(txt: string): number {
  const limpio = txt.trim().replace(',', '.');
  if (limpio === '') return NaN;
  return Number(limpio);
}

function FoodManualScreenContenido() {
  const profile = useUserStore((s: any) => s.profile);
  const addFoodLog = useUserStore((s: any) => s.addFoodLog);
  const getDailyTotals = useUserStore((s: any) => s.getDailyTotals);

  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [cal, setCal] = useState('');
  const [prot, setProt] = useState('');
  const [carbs, setCarbs] = useState('');
  const [grasa, setGrasa] = useState('');
  const [fibra, setFibra] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  const valores = {
    nombre,
    calories: aNumero(cal),
    protein_g: aNumero(prot),
    carbs_g: aNumero(carbs),
    fat_g: aNumero(grasa),
  };

  // Vista previa de las calorías que implican los macros escritos. Es la
  // forma de que el usuario vea el desajuste MIENTRAS escribe, en vez de
  // enterarse en un aviso al final.
  const implicitas = ['protein_g', 'carbs_g', 'fat_g'].every((k) => Number.isFinite((valores as any)[k]))
    ? caloriasDesdeMacros(valores)
    : null;

  async function guardar() {
    if (!profile || guardando) return;
    const v = validarComidaManual(valores);
    setErrores(v.errores);
    if (!v.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    // El aviso de desajuste se consulta, no se impone: se guarda igual si el
    // usuario lo confirma.
    if (v.aviso) {
      const seguir = await new Promise<boolean>((resolve) => {
        Alert.alert('Revisa los números', v.aviso!, [
          { text: 'Corregir', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Guardar así', onPress: () => resolve(true) },
        ]);
      });
      if (!seguir) return;
    }

    setGuardando(true);
    const totals = getDailyTotals();
    const res = await registrarComida({
      userId: profile.user_id,
      comida: {
        meal_name: nombre.trim(),
        food_description: descripcion.trim() || nombre.trim(),
        calories: Math.round(valores.calories),
        protein_g: Math.round(valores.protein_g),
        carbs_g: Math.round(valores.carbs_g),
        fat_g: Math.round(valores.fat_g),
        fiber_g: Number.isFinite(aNumero(fibra)) ? Math.round(aNumero(fibra)) : 0,
      },
      totalesPrevios: totals,
      metas: profile,
      origen: 'manual',
    });
    setGuardando(false);

    if (!res.ok) {
      Alert.alert('No pudimos guardar tu comida', res.mensaje);
      return;
    }

    addFoodLog(res.log as any);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }

  function campo(
    label: string,
    valor: string,
    set: (v: string) => void,
    opts: { clave?: string; unidad?: string; placeholder?: string; multilinea?: boolean } = {},
  ) {
    const err = opts.clave ? errores[opts.clave] : undefined;
    return (
      <View style={{ marginBottom: Spacing.md }}>
        <Text style={s.label}>{label}{opts.unidad ? ` (${opts.unidad})` : ''}</Text>
        <TextInput
          style={[s.input, opts.multilinea && s.inputMulti, !!err && s.inputErr]}
          value={valor}
          onChangeText={set}
          placeholder={opts.placeholder}
          placeholderTextColor={Colors.textDisabled}
          keyboardType={opts.unidad ? 'decimal-pad' : 'default'}
          multiline={opts.multilinea}
          accessibilityLabel={label}
          accessibilityHint={err}
        />
        {!!err && <Text style={s.err} accessibilityLiveRegion="polite">{err}</Text>}
      </View>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.nav}>
        <TouchableOpacity style={s.back} onPress={() => router.back()} hitSlop={A11y.hitSlop}
          accessibilityRole="button" accessibilityLabel="Volver">
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.navTitle} accessibilityRole="header">REGISTRAR A MANO</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={s.intro}>
            Sin foto y sin IA: no gasta tus escaneos del día. Útil cuando la etiqueta ya trae
            los números o cuando la cámara no es opción.
          </Text>

          {campo('Nombre', nombre, setNombre, { clave: 'nombre', placeholder: 'Arroz con pollo' })}
          {campo('Detalle (opcional)', descripcion, setDescripcion, { placeholder: 'Porción mediana, sin salsa', multilinea: true })}

          {campo('Calorías', cal, setCal, { clave: 'calories', unidad: 'kcal', placeholder: '500' })}

          <View style={s.fila}>
            <View style={{ flex: 1 }}>{campo('Proteína', prot, setProt, { clave: 'protein_g', unidad: 'g', placeholder: '40' })}</View>
            <View style={{ flex: 1 }}>{campo('Carbos', carbs, setCarbs, { clave: 'carbs_g', unidad: 'g', placeholder: '50' })}</View>
          </View>
          <View style={s.fila}>
            <View style={{ flex: 1 }}>{campo('Grasa', grasa, setGrasa, { clave: 'fat_g', unidad: 'g', placeholder: '12' })}</View>
            <View style={{ flex: 1 }}>{campo('Fibra (opcional)', fibra, setFibra, { unidad: 'g', placeholder: '3' })}</View>
          </View>

          {implicitas != null && implicitas > 0 && (
            <Text style={s.pista} accessibilityLiveRegion="polite">
              Esos macros equivalen a unas {Math.round(implicitas)} kcal.
            </Text>
          )}

          <TouchableOpacity style={[s.guardar, guardando && { opacity: 0.6 }]} onPress={guardar}
            disabled={guardando} activeOpacity={0.85}
            accessibilityRole="button" accessibilityLabel="Guardar esta comida"
            accessibilityState={{ disabled: guardando }}>
            {guardando
              ? <ActivityIndicator color="#0a0a0b" />
              : <Text style={s.guardarTxt}>GUARDAR COMIDA</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backTxt: { fontSize: 30, color: Colors.textPrimary, marginTop: -4 },
  navTitle: { fontFamily: Fonts.heading, fontSize: 15, color: Colors.textPrimary, letterSpacing: 1 },
  intro: {
    fontFamily: Fonts.body, fontSize: Type.body, color: Colors.textSecondary,
    lineHeight: 20, marginBottom: Spacing.lg,
  },
  label: { fontFamily: Fonts.bodySemi, fontSize: Type.caption, color: Colors.textSecondary, marginBottom: 6 },
  input: {
    backgroundColor: Colors.bgCard, borderRadius: Radii.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    fontFamily: Fonts.body, fontSize: Type.bodyLg, color: Colors.textPrimary,
  },
  inputMulti: { minHeight: 68, textAlignVertical: 'top' },
  inputErr: { borderColor: Colors.error },
  err: { fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.error, marginTop: 5 },
  fila: { flexDirection: 'row', gap: Spacing.md },
  pista: {
    fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.textMuted,
    marginBottom: Spacing.md, lineHeight: 17,
  },
  guardar: {
    backgroundColor: Colors.accent, borderRadius: Radii.lg,
    paddingVertical: 17, alignItems: 'center', marginTop: Spacing.sm,
  },
  guardarTxt: { fontFamily: Fonts.heading, fontSize: 16, color: '#0a0a0b', letterSpacing: 0.8 },
});

/**
 * GUARDIA DEL MODO RECUPERACIÓN.
 *
 * Va aquí, en la ruta, y no en quien navega hasta ella. Esta pantalla se abre
 * también por enlace directo (app.json declara el scheme "gymup") y desde
 * cualquier router.push que exista hoy o mañana: esconder el botón de origen
 * dejaba la puerta abierta.
 */
export default function FoodManualScreen() {
  return (
    <GuardiaRecuperacion area="calorias" titulo="REGISTRAR COMIDA">
      <FoodManualScreenContenido />
    </GuardiaRecuperacion>
  );
}
