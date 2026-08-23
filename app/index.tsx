import { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { loadHealthSafe } from '../lib/health';
import { cargarFlags } from '../lib/featureFlags';
import { useUserStore } from '../store/userStore';
import { fetchTodayFoodLogs, localDateKey } from '../lib/foodLogs';
import { registerForPushNotifications } from '../lib/push';
import { setupDailyNotifications } from '../lib/dailyNotifications';
import { captureError } from '../lib/monitoring';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';

// Errores de RED/servidor (fetch falló, timeout, DNS, 5xx) se distinguen de
// "no hay sesión" (usuario nunca inició sesión, o cerró sesión): lo primero
// NO debe mandar a un usuario YA registrado de vuelta a onboarding como si
// nunca hubiera tenido cuenta — eso invita a crear una cuenta duplicada por
// un problema de red pasajero. Se muestra un reintento en su lugar.
function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /network request failed|failed to fetch|timeout|abort/i.test(msg);
}

export default function Index() {
  const setProfile = useUserStore((s: any) => s.setProfile);
  const setTrainingPlan = useUserStore((s: any) => s.setTrainingPlan);
  const setOnboardingComplete = useUserStore((s: any) => s.setOnboardingComplete);
  const hydrateTodayLogs = useUserStore((s: any) => s.hydrateTodayLogs);
  const [connectionError, setConnectionError] = useState(false);

  useEffect(() => {
    checkProfile();
  }, []);

  async function checkProfile() {
    setConnectionError(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.replace('/(auth)/onboarding' as any);
        return;
      }

      const { data: profile, error: errorPerfil } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', session.user.id)
        .single();

      // UN ERROR NO ES "NO TIENE PERFIL". Se ignoraba el error y se miraba solo
      // `!profile`, así que un fallo de red o un JWT vencido mandaban al
      // onboarding a alguien que lleva meses usando la app — y el onboarding
      // hace un upsert, o sea que le pide otra vez su edad, su peso y su
      // tamizaje y se los sobrescribe. Parece que perdió todo.
      //
      // PGRST116 es "no hay filas", que sí es no tener perfil. Cualquier otro
      // código es un fallo, y ante un fallo no se toca nada.
      if (errorPerfil && errorPerfil.code !== 'PGRST116') {
        captureError(errorPerfil, { scope: 'arranque.perfil', code: errorPerfil.code });
        // La pantalla de error de conexión que ya existe más abajo: explica y
        // ofrece reintentar, en vez de mandar a rehacer el registro.
        setConnectionError(true);
        return;
      }

      if (!profile) {
        router.replace('/(auth)/onboarding' as any);
        return;
      }

      const { data: plan } = await supabase
        .from('training_plans')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('is_active', true)
        .order('generated_at', { ascending: false })
        .limit(1)
        .single();

      setProfile(profile);
      if (plan) setTrainingPlan(plan);

      // HIDRATAR EL MODO RECUPERACIÓN AQUÍ, en el arranque.
      //
      // El store nacía en NEUTRO y nadie cargaba la salud al abrir la app: la
      // hidratación dependía de que alguna pantalla llamara a loadHealthSafe
      // por otro motivo (la sesión de entreno, Mi salud, el coach). En la
      // pestaña Inicio eso no estaba garantizado, así que quien declaró un
      // trastorno de la conducta alimentaria podía abrir la app y encontrarse
      // el anillo de calorías y el peso — el modo ni siquiera estaba encendido.
      //
      // Ocultar botones no servía de nada si la bandera llegaba tarde.
      //
      // No bloquea el arranque y no rompe nada si falla: loadHealthSafe cae a
      // la caché local, y si tampoco la hay deja el modo como estaba (ver
      // lib/health.ts). Un fallo de red no puede esconderle sus datos a nadie.
      loadHealthSafe(session.user.id).catch(() => {});

      // Los interruptores remotos. Nunca lanza y cae a los valores compilados,
      // así que un fallo de red no apaga nada ni abre nada.
      cargarFlags().catch(() => {});

      // Recargar los registros de comida de HOY (antes arrancaban en 0).
      const todayLogs = await fetchTodayFoodLogs(session.user.id);
      hydrateTodayLogs(todayLogs, localDateKey());

      // Registrar push token para reactivación (no bloquea el arranque).
      registerForPushNotifications(session.user.id).catch(() => {});

      // Programar las notificaciones diarias AHORA que el usuario ya tiene
      // perfil (pedir permiso en el primer arranque en frío dispara rechazos).
      // Con el user_id para que respete notification_preferences (enabled y
      // horas). Antes se programaban tres avisos fijos ignorando la tabla.
      setupDailyNotifications(session.user.id).catch(() => {});

      setOnboardingComplete(true);
      router.replace('/(tabs)' as any);

    } catch (err: any) {
      captureError(err, { screen: 'index', step: 'checkProfile' });
      if (isNetworkError(err)) {
        // No hay forma de saber si el usuario tiene cuenta o no sin llegar al
        // servidor — mandarlo a onboarding aquí crearía una cuenta duplicada
        // por un problema de red pasajero. Se queda aquí con reintento.
        setConnectionError(true);
        return;
      }
      router.replace('/(auth)/onboarding' as any);
    }
  }

  if (connectionError) {
    return (
      <View style={s.container}>
        <Text style={s.errorTitle} accessibilityRole="header">No pudimos conectar</Text>
        <Text style={s.errorSub}>
          Revisa tu conexión a internet e intenta de nuevo. Si el problema sigue, es probable
          que el servidor esté temporalmente fuera de servicio.
        </Text>
        <TouchableOpacity style={s.retryBtn} onPress={checkProfile} activeOpacity={0.85}
          accessibilityRole="button" accessibilityLabel="Reintentar la conexión">
          <Text style={s.retryBtnTxt}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}
      accessible accessibilityLabel="Abriendo Rityvo" accessibilityState={{ busy: true }}>
      <ActivityIndicator color={Colors.accent} size="large" />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  errorTitle: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.textPrimary, marginBottom: 10, textAlign: 'center' },
  errorSub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: Spacing.xl },
  retryBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 16, paddingHorizontal: Spacing.xl },
  retryBtnTxt: { fontFamily: Fonts.heading, fontSize: 15, color: '#0a0a0b', letterSpacing: 0.6 },
});
