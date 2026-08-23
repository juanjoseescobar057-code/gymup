// Components/CompuertaDeSalud.tsx
// ─────────────────────────────────────────────────────────
// No dejar entrenar a quien declaró que no debería.
//
// La sesión de fuerza (app/workout-session.tsx) siempre tuvo esta compuerta:
// carga el tamizaje, falla CERRADO si no lo puede leer, y bloquea a quien
// declaró dolor de pecho, mareos o restricción médica sin autorización.
//
// El coach en vivo no tenía nada. Ni cargaba el perfil de salud, ni había guard
// en la ruta. La misma persona a la que la app le impedía empezar una rutina
// entraba al coach en vivo y hacía sentadillas contadas por voz. El bloqueo
// existía, pero solo en una de las dos puertas.
//
// Por eso esto es un componente y no otro bloque copiado: la próxima pantalla
// de entrenamiento se envuelve y ya nace protegida. __tests__/compuertaSalud.test.ts
// comprueba que ninguna ruta de entrenamiento se quede fuera.
//
// FALLA CERRADO A PROPÓSITO. Si no se puede leer el tamizaje no se entrena. La
// alternativa —dejar pasar cuando la red falla— convierte cualquier momento sin
// cobertura en una puerta abierta, y es justo cuando menos se puede comprobar
// nada.
// ─────────────────────────────────────────────────────────

import { useEffect, useState, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadHealthSafe } from '../lib/health';
import { evaluateWorkoutAccess, type HealthProfile } from '../lib/healthMath';
import { useUserStore } from '../store/userStore';
import { Colors, Fonts, Radii, Spacing, Type, A11y } from '../constants/theme';

type Estado = 'loading' | 'ok' | 'unknown';

export default function CompuertaDeSalud({
  children,
  titulo = 'SEGURIDAD DE LA SESIÓN',
}: {
  /** Se renderiza SOLO cuando el tamizaje se pudo leer y no bloquea. */
  children: ReactNode;
  titulo?: string;
}) {
  const profile = useUserStore((s: any) => s.profile);
  const [estado, setEstado] = useState<Estado>('loading');
  const [salud, setSalud] = useState<HealthProfile | null>(null);
  const [reintento, setReintento] = useState(0);

  useEffect(() => {
    if (!profile?.user_id) return;
    let vivo = true;
    setEstado('loading');
    loadHealthSafe(profile.user_id)
      .then((load) => {
        if (!vivo) return;
        if (load.status === 'unknown') {
          setEstado('unknown');
        } else {
          setSalud(load.profile);
          setEstado('ok');
        }
      })
      .catch(() => vivo && setEstado('unknown'));
    return () => {
      vivo = false;
    };
  }, [profile?.user_id, reintento]);

  // Sin perfil no hay edad, y sin edad evaluateWorkoutAccess no puede decidir.
  // Es el mismo caso que 'unknown': no sabemos, así que no se entrena.
  const acceso = salud && profile ? evaluateWorkoutAccess(salud, profile.age) : null;

  if (estado !== 'ok' || !acceso) {
    const cargando = estado === 'loading';
    return (
      <SafeAreaView style={s.container}>
        <Cabecera titulo={titulo} />
        <View style={s.centro}>
          <Text style={s.icono}>{cargando ? '···' : '🩺'}</Text>
          <Text style={s.titulo}>
            {cargando ? 'Revisando tu perfil de salud' : 'No pudimos verificar tu perfil'}
          </Text>
          <Text style={s.texto}>
            {cargando
              ? 'Un momento. Adaptaremos el ejercicio a lo que declaraste.'
              : 'No vamos a asumir que entrenar es seguro sin tus datos. Reintenta o revisa Mi salud; tu progreso no se pierde.'}
          </Text>
          {!cargando && (
            <>
              <TouchableOpacity
                style={s.btn}
                onPress={() => setReintento((n) => n + 1)}
                accessibilityRole="button"
                accessibilityLabel="Volver a intentar cargar el perfil de salud"
              >
                <Text style={s.btnTxt}>VOLVER A INTENTAR</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.secundario}
                onPress={() => router.push('/health' as any)}
                accessibilityRole="button"
                accessibilityLabel="Abrir Mi salud"
              >
                <Text style={s.secundarioTxt}>Abrir Mi salud</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (acceso.status === 'blocked') {
    return (
      <SafeAreaView style={s.container}>
        <Cabecera titulo="PRIMERO TU SALUD" />
        <View style={s.centro}>
          <Text style={s.icono}>🛑</Text>
          <Text style={s.titulo}>{acceso.title}</Text>
          <Text style={s.texto}>{acceso.detail}</Text>
          {acceso.reasons.slice(0, 3).map((r) => (
            <Text key={r} style={s.motivo}>• {r}</Text>
          ))}
          <TouchableOpacity
            style={s.btn}
            onPress={() => router.push('/health' as any)}
            accessibilityRole="button"
            accessibilityLabel="Revisar Mi salud"
          >
            <Text style={s.btnTxt}>REVISAR MI SALUD</Text>
          </TouchableOpacity>
          <Text style={s.pie}>
            Si tienes dolor de pecho, dificultad para respirar, mareo intenso o desmayo, busca
            atención urgente.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return <>{children}</>;
}

function Cabecera({ titulo }: { titulo: string }) {
  return (
    <View style={s.header}>
      <TouchableOpacity
        style={s.cerrar}
        onPress={() => router.back()}
        hitSlop={A11y.hitSlopLg}
        accessibilityRole="button"
        accessibilityLabel="Volver"
      >
        <Text style={s.cerrarTxt}>✕</Text>
      </TouchableOpacity>
      <Text style={s.headerTitulo} accessibilityRole="header">{titulo}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

const s = StyleSheet.create({
  // Los mismos valores que la compuerta de app/workout-session.tsx: si las dos
  // puertas se ven distintas, la persona cree que le pasó algo distinto.
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  cerrar: {
    width: 40,
    height: 40,
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cerrarTxt: { fontFamily: Fonts.headingBold, fontSize: 16, color: Colors.textMuted },
  headerTitulo: { fontFamily: Fonts.heading, fontSize: 15, color: Colors.textPrimary, letterSpacing: 1 },
  centro: { flex: 1, justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  icono: { fontSize: 42, textAlign: 'center', color: Colors.accent },
  titulo: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.textPrimary, textAlign: 'center' },
  texto: {
    fontFamily: Fonts.body,
    fontSize: Type.bodyLg,
    lineHeight: 24,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  motivo: { fontFamily: Fonts.body, fontSize: Type.body, lineHeight: 21, color: Colors.textSecondary },
  btn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 17, alignItems: 'center' },
  btnTxt: { fontFamily: Fonts.heading, fontSize: 16, color: '#0a0a0b', letterSpacing: 0.8 },
  secundario: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.lg,
  },
  secundarioTxt: { fontFamily: Fonts.heading, fontSize: Type.body, color: Colors.textPrimary },
  pie: {
    fontFamily: Fonts.body,
    fontSize: Type.caption,
    lineHeight: 18,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
