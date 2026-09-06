// app/actividad.tsx
// ─────────────────────────────────────────────────────────
// TU MES: calendario con los días que entrenaste, los números del mes y
// qué ejercicios hiciste. Responde a "¿cuántas veces fui?" de un vistazo y,
// tocando un día, a "¿qué hice ese día?".
//
// Solo datos de entrenamiento (sesiones, series, pesos levantados). Nada del
// cuerpo ni de comida: no hay nada que esconder en modo recuperación.
// ─────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useUserStore } from '../store/userStore';
import { track } from '../lib/analytics';
import { captureError } from '../lib/monitoring';
import {
  fetchActividadMensual, rejillaDelMes, etiquetaDuracion, etiquetaKg, etiquetaComparacion,
  MESES, DIAS_CORTOS, DIAS_SEMANA, type ActividadMensual,
} from '../lib/actividadMensual';
import { Colors, Fonts, Radii, Spacing, Type, A11y } from '../constants/theme';

const { width } = Dimensions.get('window');
const HUECO = 4;
const CELDA = Math.floor((width - Spacing.lg * 2 - Spacing.md * 2 - HUECO * 6) / 7);
const EJERCICIOS_VISIBLES = 8;

export default function ActividadScreen() {
  const profile = useUserStore((s: any) => s.profile);
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth());
  const [datos, setDatos] = useState<ActividadMensual | null>(null);
  const [loading, setLoading] = useState(true);
  const [fallo, setFallo] = useState(false);
  const [diaSel, setDiaSel] = useState<number | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  const esMesActual = anio === hoy.getFullYear() && mes === hoy.getMonth();

  const cargar = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    setFallo(false);
    try {
      const d = await fetchActividadMensual(profile.user_id, anio, mes);
      setDatos(d);
      track('monthly_activity_viewed', {
        month: `${anio}-${String(mes + 1).padStart(2, '0')}`,
        workouts: d.resumen.entrenos,
        is_current_month: anio === hoy.getFullYear() && mes === hoy.getMonth(),
      });
    } catch (e) {
      captureError(e, { scope: 'actividad_mensual', anio, mes });
      setFallo(true);
    } finally {
      setLoading(false);
    }
  }, [profile?.user_id, anio, mes]);

  useEffect(() => { cargar(); }, [cargar]);

  function cambiarMes(delta: number) {
    if (delta > 0 && esMesActual) return;
    Haptics.selectionAsync();
    setDiaSel(null);
    setVerTodos(false);
    const d = new Date(anio, mes + delta, 1);
    setAnio(d.getFullYear());
    setMes(d.getMonth());
  }

  const resumen = datos?.resumen;
  const filas = rejillaDelMes(anio, mes);
  const nombreMes = MESES[mes];
  const tituloMes = `${nombreMes[0].toUpperCase()}${nombreMes.slice(1)} ${anio}`;
  const detalleDia = diaSel != null && resumen ? resumen.porDia[diaSel] : undefined;
  const ejercicios = resumen?.ejercicios ?? [];
  const ejerciciosVisibles = verTodos ? ejercicios : ejercicios.slice(0, EJERCICIOS_VISIBLES);

  function nombreDia(d: number) {
    return DIAS_SEMANA[(new Date(anio, mes, d).getDay() + 6) % 7];
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.nav}>
        <TouchableOpacity style={s.back} onPress={() => router.back()}
          accessibilityRole="button" accessibilityLabel="Volver">
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.navTitle} accessibilityRole="header">TU MES</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Mes */}
      <View style={s.mesRow}>
        <TouchableOpacity style={s.mesBtn} onPress={() => cambiarMes(-1)} hitSlop={A11y.hitSlop}
          accessibilityRole="button" accessibilityLabel="Mes anterior">
          <Text style={s.mesBtnTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.mesTitulo} accessibilityRole="header">{tituloMes}</Text>
        <TouchableOpacity
          style={[s.mesBtn, esMesActual && s.mesBtnOff]}
          onPress={() => cambiarMes(1)}
          hitSlop={A11y.hitSlop}
          disabled={esMesActual}
          accessibilityRole="button"
          accessibilityLabel="Mes siguiente"
          accessibilityState={{ disabled: esMesActual }}
        >
          <Text style={[s.mesBtnTxt, esMesActual && { opacity: 0.3 }]}>›</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.centro} accessible accessibilityLabel="Cargando tu mes" accessibilityState={{ busy: true }}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : fallo || !resumen ? (
        <View style={s.centro}>
          <Text style={s.vacioTitulo}>No pudimos cargar tu mes</Text>
          <Text style={s.vacioTxt}>Revisa tu conexión e inténtalo de nuevo.</Text>
          <TouchableOpacity style={s.btn} onPress={cargar} accessibilityRole="button" accessibilityLabel="Reintentar">
            <Text style={s.btnTxt}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingTop: 0 }} showsVerticalScrollIndicator={false}>

          {/* Números del mes */}
          <View style={s.kpiGrid}>
            <View style={[s.kpi, s.kpiGrande]} accessible
              accessibilityLabel={`${resumen.entrenos} entrenos en ${nombreMes}, ${etiquetaComparacion(resumen.entrenos, datos!.entrenosMesAnterior, mes - 1)}`}>
              <Text style={s.kpiNum}>{resumen.entrenos}</Text>
              <Text style={s.kpiLbl}>{resumen.entrenos === 1 ? 'entreno' : 'entrenos'}</Text>
              <Text style={s.kpiSub}>
                {resumen.entrenos > 0 ? `≈ ${resumen.porSemana} por semana · ` : ''}
                {etiquetaComparacion(resumen.entrenos, datos!.entrenosMesAnterior, mes - 1)}
              </Text>
            </View>
            <View style={s.kpi} accessible accessibilityLabel={`Tiempo entrenando: ${etiquetaDuracion(resumen.minutos)}`}>
              <Text style={s.kpiNumChico}>{etiquetaDuracion(resumen.minutos)}</Text>
              <Text style={s.kpiLbl}>entrenando</Text>
            </View>
            <View style={s.kpi} accessible accessibilityLabel={`${resumen.series} series`}>
              <Text style={s.kpiNumChico}>{resumen.series}</Text>
              <Text style={s.kpiLbl}>series</Text>
            </View>
            <View style={s.kpi} accessible accessibilityLabel={`Peso total movido: ${etiquetaKg(resumen.volumenKg)}`}>
              <Text style={s.kpiNumChico}>{etiquetaKg(resumen.volumenKg)}</Text>
              <Text style={s.kpiLbl}>peso movido</Text>
            </View>
          </View>

          {/* Calendario */}
          <View style={s.calendario}>
            <View style={s.filaDias}>
              {DIAS_CORTOS.map((d, i) => (
                <Text key={i} style={s.diaCabecera} importantForAccessibility="no">{d}</Text>
              ))}
            </View>
            {filas.map((fila, i) => (
              <View key={i} style={s.filaDias}>
                {fila.map((d, j) => {
                  if (d == null) return <View key={j} style={s.celda} />;
                  const entreno = (resumen.porDia[d]?.entrenos ?? 0) > 0;
                  const esHoy = esMesActual && d === hoy.getDate();
                  const futuro = esMesActual && d > hoy.getDate();
                  const sel = diaSel === d;
                  return (
                    <TouchableOpacity
                      key={j}
                      style={[s.celda, entreno && s.celdaEntreno, esHoy && s.celdaHoy, sel && s.celdaSel]}
                      onPress={() => { if (entreno) { Haptics.selectionAsync(); setDiaSel(sel ? null : d); } }}
                      activeOpacity={entreno ? 0.7 : 1}
                      accessibilityRole={entreno ? 'button' : 'text'}
                      accessibilityLabel={`${nombreDia(d)} ${d} de ${nombreMes}${entreno ? ', entrenaste' : futuro ? '' : ', sin entreno'}`}
                      accessibilityState={{ selected: sel }}
                    >
                      <Text style={[s.celdaTxt, entreno && s.celdaTxtEntreno, futuro && { opacity: 0.3 }]}>{d}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
            {resumen.entrenos === 0 && (
              <Text style={s.calendarioVacio}>
                {esMesActual
                  ? 'Este mes todavía no tiene entrenos. Cuando termines uno, aquí se marca el día.'
                  : `Sin entrenos en ${nombreMes}.`}
              </Text>
            )}
          </View>

          {/* Día tocado */}
          {diaSel != null && detalleDia && (
            <View style={s.detalle} accessible
              accessibilityLabel={`${nombreDia(diaSel)} ${diaSel}: ${detalleDia.entrenos} ${detalleDia.entrenos === 1 ? 'entreno' : 'entrenos'}, ${etiquetaDuracion(detalleDia.minutos)}. ${detalleDia.ejercicios.join(', ')}`}>
              <Text style={s.detalleTitulo}>
                {nombreDia(diaSel)[0].toUpperCase()}{nombreDia(diaSel).slice(1)} {diaSel} · {detalleDia.entrenos === 1 ? '1 entreno' : `${detalleDia.entrenos} entrenos`} · {etiquetaDuracion(detalleDia.minutos)}
              </Text>
              {detalleDia.ejercicios.length > 0 ? (
                <Text style={s.detalleTxt}>{detalleDia.ejercicios.join(' · ')}</Text>
              ) : (
                <Text style={s.detalleTxt}>Sin series registradas ese día.</Text>
              )}
            </View>
          )}

          {/* Ejercicios */}
          <Text style={s.sectionLbl} accessibilityRole="header">🏋️ EJERCICIOS DEL MES</Text>
          {ejercicios.length === 0 ? (
            <Text style={s.vacioTxt}>
              Registra el peso y las reps de tus series y aquí verás qué hiciste, cuántas veces y tu mejor serie de cada ejercicio.
            </Text>
          ) : (
            <>
              {ejerciciosVisibles.map((e) => (
                <View key={e.nombre} style={s.ejercicio} accessible
                  accessibilityLabel={
                    `${e.nombre}: ${e.series} series en ${e.dias} ${e.dias === 1 ? 'día' : 'días'}` +
                    (e.mejor ? `. Mejor serie: ${e.mejor.peso} kilos por ${e.mejor.reps} repeticiones` : '') +
                    (e.volumenKg > 0 ? `. ${etiquetaKg(e.volumenKg)} movidos` : '')
                  }>
                  <View style={{ flex: 1 }}>
                    <Text style={s.ejercicioNombre}>{e.nombre}</Text>
                    <Text style={s.ejercicioMeta}>
                      {e.series} {e.series === 1 ? 'serie' : 'series'} · {e.dias} {e.dias === 1 ? 'día' : 'días'}
                      {e.volumenKg > 0 ? ` · ${etiquetaKg(e.volumenKg)}` : ''}
                    </Text>
                  </View>
                  {e.mejor && (
                    <View style={s.mejor}>
                      <Text style={s.mejorNum}>{e.mejor.peso}<Text style={s.mejorUnidad}> kg</Text> × {e.mejor.reps}</Text>
                      <Text style={s.mejorLbl}>mejor serie</Text>
                    </View>
                  )}
                </View>
              ))}
              {ejercicios.length > EJERCICIOS_VISIBLES && (
                <TouchableOpacity style={s.verMas} onPress={() => setVerTodos((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={verTodos ? 'Ver menos ejercicios' : `Ver los ${ejercicios.length - EJERCICIOS_VISIBLES} ejercicios restantes`}>
                  <Text style={s.verMasTxt}>
                    {verTodos ? 'Ver menos' : `Ver los ${ejercicios.length - EJERCICIOS_VISIBLES} restantes`}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}

          <TouchableOpacity style={s.enlace} onPress={() => router.push('/history' as any)}
            accessibilityRole="button" accessibilityLabel="Ver tus récords de todos los tiempos">
            <Text style={s.enlaceTxt}>🏆 Ver mis récords de siempre →</Text>
          </TouchableOpacity>
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
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },

  mesRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  mesBtn: { width: 44, height: 44, borderRadius: Radii.full, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  mesBtnOff: { borderColor: Colors.border, opacity: 0.6 },
  mesBtnTxt: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.textPrimary, lineHeight: 28 },
  mesTitulo: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.textPrimary, letterSpacing: 0.3 },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  kpi: { flexGrow: 1, flexBasis: '30%', backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, alignItems: 'center' },
  kpiGrande: { flexBasis: '100%', backgroundColor: Colors.accentMuted, borderColor: Colors.accentBorder },
  kpiNum: { fontFamily: Fonts.heading, fontSize: 52, color: Colors.accent, lineHeight: 54 },
  kpiNumChico: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary },
  kpiLbl: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 },
  kpiSub: { fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.textSecondary, marginTop: 6, textAlign: 'center' },

  calendario: { backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: Spacing.md },
  filaDias: { flexDirection: 'row', gap: HUECO, marginBottom: HUECO },
  diaCabecera: { width: CELDA, textAlign: 'center', fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, letterSpacing: 0.6 },
  celda: { width: CELDA, height: CELDA, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  celdaEntreno: { backgroundColor: Colors.accent },
  celdaHoy: { borderColor: Colors.accent },
  celdaSel: { borderColor: Colors.textPrimary, borderWidth: 2 },
  celdaTxt: { fontFamily: Fonts.bodyMedium, fontSize: Type.body, color: Colors.textSecondary },
  celdaTxtEntreno: { fontFamily: Fonts.bodySemi, color: Colors.bg },
  calendarioVacio: { fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.textMuted, textAlign: 'center', lineHeight: 18, marginTop: Spacing.sm },

  detalle: { backgroundColor: Colors.bgCard, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.accentBorder, padding: Spacing.md, marginBottom: Spacing.md },
  detalleTitulo: { fontFamily: Fonts.bodySemi, fontSize: Type.body, color: Colors.textPrimary, marginBottom: 4 },
  detalleTxt: { fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.textSecondary, lineHeight: 18 },

  sectionLbl: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: Spacing.sm, marginTop: Spacing.sm },
  ejercicio: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.bgCard, borderRadius: Radii.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: Spacing.sm },
  ejercicioNombre: { fontFamily: Fonts.bodySemi, fontSize: Type.body, color: Colors.textPrimary },
  ejercicioMeta: { fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.textMuted, marginTop: 2 },
  mejor: { alignItems: 'flex-end' },
  mejorNum: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.accent },
  mejorUnidad: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted },
  mejorLbl: { fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted },
  verMas: { alignItems: 'center', paddingVertical: Spacing.sm },
  verMasTxt: { fontFamily: Fonts.bodySemi, fontSize: Type.body, color: Colors.accent },

  vacioTitulo: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary, marginBottom: 8, textAlign: 'center' },
  vacioTxt: { fontFamily: Fonts.body, fontSize: Type.body, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
  btn: { marginTop: Spacing.md, backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingHorizontal: 24, paddingVertical: 12 },
  btnTxt: { fontFamily: Fonts.bodySemi, fontSize: Type.body, color: Colors.bg },
  enlace: { alignItems: 'center', paddingVertical: Spacing.md, marginTop: Spacing.sm },
  enlaceTxt: { fontFamily: Fonts.bodySemi, fontSize: Type.body, color: Colors.textSecondary },
});
