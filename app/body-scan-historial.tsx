// app/body-scan-historial.tsx
// ─────────────────────────────────────────────────────────
// Los análisis corporales anteriores.
//
// Faltaban. Los análisis se guardaban enteros en body_scans —score, zonas,
// fortalezas, enfoque y las notas para el plan— y no había ninguna pantalla que
// los leyera: se salía de los resultados y desaparecían. Alguien pagaba por un
// análisis, lo leía una vez, y no podía volver a él ni comparar con el
// anterior. Se detectó probando: "cuando me tomé la foto de cuerpo completo me
// dijo unas cosas y salí de ahí y eso desapareció".
//
// LO QUE NO HAY, Y SE DICE: las fotos no se guardan. El análisis se hace y las
// imágenes no salen del teléfono más que hacia OpenAI para esa llamada. Es
// deliberado, y una pantalla de historial que no lo diga deja a la gente
// buscando unas fotos que no existen. Las fotos de transformación son otra cosa
// y viven en Progreso.
//
// La compuerta del modo recuperación va EN LA RUTA, igual que en body-scan: el
// scheme "gymup" abre esto por enlace directo y este es justo el contenido
// —"~X% de grasa", un score corporal— que ese modo existe para retirar.
// ─────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useUserStore } from '../store/userStore';
import { captureError } from '../lib/monitoring';
import { Colors, Fonts, Radii, Spacing, Type } from '../constants/theme';
import { MIN_FAT_PCT, MAX_FAT_PCT } from '../lib/safety';
import GuardiaRecuperacion from '../Components/GuardiaRecuperacion';
import GuardiaFlag from '../Components/GuardiaFlag';

type Zona = { id?: string; label?: string; status?: string; message?: string; tip?: string };

type Escaneo = {
  id: string;
  scanned_at: string;
  overall_score: number | null;
  estimated_fat_pct: number | null;
  estimated_muscle_level: string | null;
  zones: Zona[] | null;
  strengths: string[] | null;
  focus_areas: string[] | null;
  notes: string | null;
  photos_count: number | null;
};

// La misma banda de incertidumbre que la pantalla de análisis. Un número exacto
// desde una foto sin calibrar es falsa precisión, y en un historial se compara
// contra el anterior — que es justo donde una décima inventada se lee como
// progreso o retroceso.
const INCERTIDUMBRE = 3;

function rangoGrasa(pct: number): string {
  const mid = Math.round(pct);
  return `${Math.max(MIN_FAT_PCT, mid - INCERTIDUMBRE)}-${Math.min(MAX_FAT_PCT, mid + INCERTIDUMBRE)}%`;
}

function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

const COLOR_ESTADO: Record<string, string> = {
  strength: Colors.accent,
  focus: Colors.warning,
  priority: Colors.error,
};

function Tarjeta({ e, esUltimo, anterior }: { e: Escaneo; esUltimo: boolean; anterior: Escaneo | null }) {
  const [abierto, setAbierto] = useState(esUltimo);

  // La diferencia contra el análisis ANTERIOR, que es la única lectura útil de
  // un historial. Se enseña sin adjetivos: "3 puntos más" y no "mejoraste".
  const deltaScore =
    e.overall_score != null && anterior?.overall_score != null
      ? e.overall_score - anterior.overall_score
      : null;

  const zonasATrabajar = (e.zones ?? []).filter(
    (z) => z.status === 'focus' || z.status === 'priority'
  );

  return (
    <View style={s.card}>
      <TouchableOpacity
        onPress={() => setAbierto((v) => !v)}
        activeOpacity={0.85}
        style={s.cabecera}
        accessibilityRole="button"
        accessibilityState={{ expanded: abierto }}
        accessibilityLabel={
          `Análisis del ${fechaLarga(e.scanned_at)}. ` +
          (e.overall_score != null ? `Puntaje ${e.overall_score} de 100. ` : '') +
          (e.estimated_fat_pct != null ? `Grasa estimada ${rangoGrasa(e.estimated_fat_pct)}. ` : '') +
          (abierto ? 'Tocar para cerrar' : 'Tocar para ver el detalle')
        }
      >
        <View style={{ flex: 1 }}>
          <Text style={s.fecha}>{fechaLarga(e.scanned_at)}</Text>
          <View style={s.metricas}>
            {e.overall_score != null && (
              <Text style={s.score}>
                {e.overall_score}<Text style={s.scoreDe}>/100</Text>
              </Text>
            )}
            {e.estimated_fat_pct != null && (
              <Text style={s.grasa}>{rangoGrasa(e.estimated_fat_pct)} grasa</Text>
            )}
          </View>
          {deltaScore != null && deltaScore !== 0 && (
            <Text style={s.delta}>
              {deltaScore > 0 ? '+' : ''}{deltaScore} puntos respecto al anterior
            </Text>
          )}
        </View>
        <Text style={s.chevron}>{abierto ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {abierto && (
        <View style={s.detalle}>
          {!!e.estimated_muscle_level && (
            <Text style={s.linea}>Nivel muscular estimado: {e.estimated_muscle_level}</Text>
          )}

          {!!e.strengths?.length && (
            <>
              <Text style={s.subtitulo}>Lo que salió bien</Text>
              {e.strengths.map((f, i) => (
                <Text key={i} style={s.item}>· {f}</Text>
              ))}
            </>
          )}

          {zonasATrabajar.length > 0 && (
            <>
              <Text style={s.subtitulo}>Zonas a trabajar</Text>
              {zonasATrabajar.map((z, i) => (
                <View key={i} style={s.zona}>
                  <Text style={[s.zonaLbl, { color: COLOR_ESTADO[z.status ?? ''] ?? Colors.textMuted }]}>
                    {z.label ?? 'Zona'}
                  </Text>
                  {!!z.message && <Text style={s.item}>{z.message}</Text>}
                  {!!z.tip && <Text style={s.tip}>→ {z.tip}</Text>}
                </View>
              ))}
            </>
          )}

          {!!e.focus_areas?.length && (
            <>
              <Text style={s.subtitulo}>En qué enfocarte</Text>
              {e.focus_areas.map((f, i) => (
                <Text key={i} style={s.item}>· {f}</Text>
              ))}
            </>
          )}

          {!!e.notes && (
            <>
              <Text style={s.subtitulo}>Qué cambiar en tu plan</Text>
              <Text style={s.item}>{e.notes}</Text>
            </>
          )}

          <Text style={s.pieFoto}>
            {e.photos_count ?? 1} foto{(e.photos_count ?? 1) === 1 ? '' : 's'} analizada
            {(e.photos_count ?? 1) === 1 ? '' : 's'}. No las guardamos: se analizan y no se
            almacenan en ninguna parte.
          </Text>
        </View>
      )}
    </View>
  );
}

function HistorialContenido() {
  const profile = useUserStore((s: any) => s.profile);
  const [escaneos, setEscaneos] = useState<Escaneo[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!profile?.user_id) return;
    supabase
      .from('body_scans')
      .select('id, scanned_at, overall_score, estimated_fat_pct, estimated_muscle_level, zones, strengths, focus_areas, notes, photos_count')
      .eq('user_id', profile.user_id)
      .order('scanned_at', { ascending: false })
      .limit(30)
      .then(({ data, error: e }) => {
        if (e) {
          // Un fallo NO es "no tienes análisis": eso le diría a alguien que
          // perdió su historial cuando solo se cayó la red.
          captureError(e, { scope: 'bodyScanHistorial' });
          setError(true);
          return;
        }
        setEscaneos((data ?? []) as Escaneo[]);
      });
  }, [profile?.user_id]);

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.volver}
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <Text style={s.volverTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.titulo} accessibilityRole="header">TUS ANÁLISIS</Text>
        <View style={s.volver} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {escaneos === null && !error && (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: 40 }} />
        )}

        {error && (
          <View style={s.vacio}>
            <Text style={s.vacioTitulo}>No pudimos cargar tus análisis</Text>
            <Text style={s.vacioTxt}>
              Parece un problema de conexión. Tus análisis siguen guardados; vuelve a
              entrar en un momento.
            </Text>
          </View>
        )}

        {escaneos?.length === 0 && (
          <View style={s.vacio}>
            <Text style={s.vacioTitulo}>Todavía no tienes análisis</Text>
            <Text style={s.vacioTxt}>
              Cuando hagas tu primer análisis corporal aparecerá aquí, y podrás compararlo
              con los siguientes.
            </Text>
            <TouchableOpacity
              style={s.cta}
              onPress={() => router.replace('/body-scan' as any)}
              accessibilityRole="button"
              accessibilityLabel="Hacer mi primer análisis corporal"
            >
              <Text style={s.ctaTxt}>HACER MI PRIMER ANÁLISIS</Text>
            </TouchableOpacity>
          </View>
        )}

        {escaneos?.map((e, i) => (
          <Tarjeta
            key={e.id}
            e={e}
            esUltimo={i === 0}
            anterior={escaneos[i + 1] ?? null}
          />
        ))}

        {!!escaneos?.length && (
          <Text style={s.disclaimer}>
            El puntaje y el rango de grasa salen de mirar una foto sin calibrar: sirven para
            seguir tu evolución, no como una medición ni como una nota.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * GUARDIA DEL MODO RECUPERACIÓN, en la ruta.
 *
 * Mismo motivo que en body-scan.tsx: el scheme "gymup" abre esto por enlace
 * directo, y "~18-24% grasa" con un puntaje al lado es exactamente el contenido
 * que ese modo retira. Poner la compuerta en el botón de origen dejaría la
 * puerta abierta.
 */
export default function BodyScanHistorialScreen() {
  return (
    <GuardiaFlag clave="body_scan" titulo="TUS ANÁLISIS">
      <GuardiaRecuperacion area="cuerpo" titulo="TUS ANÁLISIS">
        <HistorialContenido />
      </GuardiaRecuperacion>
    </GuardiaFlag>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  volver: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  volverTxt: { fontFamily: Fonts.heading, fontSize: 30, color: Colors.accent, lineHeight: 34 },
  titulo: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.textPrimary, letterSpacing: 1 },
  scroll: { paddingHorizontal: Spacing.lg, paddingBottom: 48 },

  card: {
    backgroundColor: Colors.bgCard, borderRadius: Radii.md,
    marginBottom: Spacing.md, overflow: 'hidden',
  },
  cabecera: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, minHeight: 64 },
  fecha: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted, textTransform: 'capitalize' },
  metricas: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.md, marginTop: 4 },
  score: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.accent },
  scoreDe: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  grasa: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textPrimary },
  delta: { fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.textMuted, marginTop: 4 },
  chevron: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, paddingLeft: Spacing.sm },

  detalle: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },
  subtitulo: {
    fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: Spacing.md, marginBottom: 6,
  },
  linea: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, marginTop: 4 },
  item: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, lineHeight: 21, marginBottom: 4 },
  zona: { marginBottom: Spacing.sm },
  zonaLbl: { fontFamily: Fonts.bodySemi, fontSize: 14, marginBottom: 2 },
  tip: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, lineHeight: 19, marginBottom: 2 },
  pieFoto: {
    fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textDisabled,
    lineHeight: 15, marginTop: Spacing.md,
  },

  vacio: { alignItems: 'center', paddingTop: 60, paddingHorizontal: Spacing.md },
  vacioTitulo: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.textPrimary, textAlign: 'center' },
  vacioTxt: {
    fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted,
    textAlign: 'center', lineHeight: 21, marginTop: Spacing.sm,
  },
  cta: {
    backgroundColor: Colors.accent, borderRadius: Radii.md, minHeight: 48,
    paddingHorizontal: Spacing.lg, alignItems: 'center', justifyContent: 'center',
    marginTop: Spacing.lg,
  },
  ctaTxt: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.bg, letterSpacing: 0.5 },

  disclaimer: {
    fontFamily: Fonts.body, fontSize: Type.micro, color: Colors.textMuted,
    textAlign: 'center', lineHeight: 16, marginTop: Spacing.sm,
  },
});
