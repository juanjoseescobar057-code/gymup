// lib/dailyNotifications.ts
// ─────────────────────────────────────────────────────────
// Programa las notificaciones diarias locales. Se llama cuando el usuario YA
// tiene perfil (no en el primer arranque en frío: pedir el permiso antes de
// que la app muestre valor dispara rechazos que no tienen recuperación).
//
// SOBRE EL TONO — esto no es una preferencia estética.
// La versión anterior comparaba al usuario con otras personas ("alguien más ya
// está en el gym", "tu competencia", "¿vas a dejar que te ganen?"), llamaba
// mentirosa a la cama y decía "no tienes que querer hacerlo, solo tienes que
// hacerlo". En una app que atiende a gente con lesiones, dolor, embarazo o una
// relación difícil con su cuerpo, ese texto llega justo el día que alguien no
// puede entrenar, y empuja exactamente hacia donde nuestras propias reglas de
// seguridad dicen que no hay que empujar: entrenar a través del dolor.
//
// El criterio nuevo: invitar sin culpar, ofrecer una salida pequeña siempre
// ("15 minutos cuentan"), no comparar con nadie, y no asumir que no entrenó.
// ─────────────────────────────────────────────────────────

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Identificadores propios: sin ellos había que llamar a
// cancelAllScheduledNotificationsAsync(), que borraba TAMBIÉN los recordatorios
// que programara cualquier otra parte de la app.
const IDS = {
  morning: 'gymup_daily_morning',
  afternoon: 'gymup_daily_afternoon',
  night: 'gymup_daily_night',
} as const;

type Momento = keyof typeof IDS;

function randomMessage(type: Momento): string {
  const messages: Record<Momento, string[]> = {
    morning: [
      'Buenos días. Tu plan de hoy te espera cuando estés listo.',
      'Hoy suma cualquier cosa que hagas: una sesión completa o 15 minutos.',
      'Si hoy tienes energía, aprovéchala. Si no, un día suave también es parte del plan.',
      'Tu cuerpo lleva toda la noche recuperándose. Úsalo a tu ritmo.',
      'Un paso pequeño hoy vale más que un plan perfecto mañana.',
      'Cuando quieras empezar, tu rutina ya está lista.',
    ],
    afternoon: [
      '¿Cómo vas hoy? Si aún no te has movido, hay tiempo de sobra.',
      'Quince minutos cuentan. No tiene que ser la sesión completa.',
      'Si el día se complicó, mover un poco el cuerpo ya es ganancia.',
      'Tu rutina sigue ahí, sin prisa. Entra cuando puedas.',
      'Si hoy no es el día, está bien. Mañana seguimos.',
      'Un buen momento para revisar cómo te sientes y decidir qué te conviene hoy.',
    ],
    night: [
      '¿Quieres registrar lo que comiste hoy? Toma un momento.',
      'Dormir bien es parte del entrenamiento. Descansa.',
      'Si entrenaste hoy, tu cuerpo lo está aprovechando ahora mismo.',
      'Cierra el día como quieras: registrar la comida ayuda, pero no es obligación.',
      'Mañana hay otra oportunidad, sin cuentas pendientes.',
      'Buenas noches. La recuperación cuenta tanto como la sesión.',
    ],
  };
  const list = messages[type];
  return list[Math.floor(Math.random() * list.length)];
}

/** Preferencias del usuario, con los valores por defecto de la tabla. */
async function loadPrefs(userId: string): Promise<{ enabled: boolean; wake: number; workout: number }> {
  try {
    const { data } = await supabase
      .from('notification_preferences')
      .select('enabled, wake_up_hour, workout_hour')
      .eq('user_id', userId)
      .maybeSingle();
    return {
      enabled: data?.enabled ?? true,
      wake: typeof data?.wake_up_hour === 'number' ? data.wake_up_hour : 7,
      workout: typeof data?.workout_hour === 'number' ? data.workout_hour : 18,
    };
  } catch {
    // Sin preferencias legibles se usan los valores por defecto: quedarse sin
    // recordatorios por un fallo de red es peor que recordar a la hora estándar.
    return { enabled: true, wake: 7, workout: 18 };
  }
}

/**
 * Canal de Android. Rescatado del módulo `notifications.ts` que se eliminó:
 * era lo único con valor real que tenía.
 *
 * Desde Android 8 toda notificación pertenece a un canal. Sin declararlo, las
 * nuestras caían en el canal por defecto y el usuario no podía ajustarlas de
 * forma granular desde los ajustes del sistema — solo apagarlas todas. Tener
 * canal propio es también lo que permite, más adelante, separar "recordatorios
 * diarios" de "logros" para que se puedan silenciar por separado.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('gymup', {
      name: 'Recordatorios de GymUp',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#C8FF3E',
      sound: 'default',
    });
  } catch {
    // Sin canal las notificaciones siguen funcionando en el canal por defecto.
  }
}

/** Cancela solo LAS NUESTRAS, nunca las de otras partes de la app. */
export async function cancelDailyNotifications(): Promise<void> {
  await Promise.all(
    Object.values(IDS).map((id) =>
      Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
    )
  );
}

export async function setupDailyNotifications(userId?: string): Promise<void> {
  try {
    // En emulador no hay notificaciones: pedir el permiso ahí solo ensucia.
    if (!Device.isDevice) return;

    // El permiso solo se pide si no lo tenemos ya: volver a pedirlo en cada
    // arranque no muestra nada nuevo y en Android puede contar como rechazo.
    const actual = await Notifications.getPermissionsAsync();
    const status = actual.granted
      ? 'granted'
      : (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;

    await ensureAndroidChannel();

    // La tabla notification_preferences existía y NADIE la consultaba: se
    // programaban tres avisos fijos a las 8, 18 y 21 pasara lo que pasara.
    const prefs = userId ? await loadPrefs(userId) : { enabled: true, wake: 7, workout: 18 };

    await cancelDailyNotifications();
    if (!prefs.enabled) return;

    // channelId va en el TRIGGER, no en el content (así lo define la API).
    const daily = (hour: number, minute: number): Notifications.DailyTriggerInput => ({
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      channelId: 'gymup',
      hour,
      minute,
    });

    // La de la mañana sale una hora después de despertarse, y la de la tarde a
    // la hora en que el usuario dijo que entrena — no a una hora inventada.
    const horaManana = Math.min(23, Math.max(0, prefs.wake + 1));
    const horaTarde = Math.min(23, Math.max(0, prefs.workout));
    const horaNoche = Math.min(23, Math.max(0, horaTarde + 3));

    await Notifications.scheduleNotificationAsync({
      identifier: IDS.morning,
      content: { title: '☀️ Buenos días', body: randomMessage('morning'), sound: 'default' },
      trigger: daily(horaManana, 0),
    });
    await Notifications.scheduleNotificationAsync({
      identifier: IDS.afternoon,
      content: { title: '💪 Tu rutina te espera', body: randomMessage('afternoon'), sound: 'default' },
      trigger: daily(horaTarde, 0),
    });
    await Notifications.scheduleNotificationAsync({
      identifier: IDS.night,
      content: { title: '🌙 Cierra el día', body: randomMessage('night'), sound: 'default' },
      trigger: daily(horaNoche, 0),
    });
  } catch (e: any) {
    console.log('[Notifications] Error:', e?.message);
  }
}

// ─── DIRECCIÓN FUTURA (rescatada de notifications.ts, ya eliminado) ──
// Aquel módulo, que nunca llegó a estar cableado, tenía una idea mejor que la
// de este: notificar POR SITUACIÓN en vez de por reloj. Bancos de mensajes
// para racha activa, logro desbloqueado, cerca de la meta del día. Eso vale y
// vale la pena retomarlo — un aviso que llega porque acabas de encadenar 7
// días dice algo; uno que llega porque son las 18:00 no.
//
// Lo que NO se rescató, y conviene que quede escrito para que no vuelva:
//   • Todo su copy comparaba y culpaba ("tu competencia", "excusas 0").
//   • Su generador con IA pedía explícitamente un tono "agresivo/desafiante"
//     y daba como ejemplo a imitar "Tu ex acaba de publicar foto en el gym".
//     Texto impredecible que nadie revisa antes de que le llegue a alguien,
//     y una llamada de IA por notificación.
//   • Su programador usaba `repeats: false` (se disparaba UNA vez, no a
//     diario) y cancelaba TODAS las notificaciones del sistema.
// Si se retoma lo situacional, que sea con este estándar de tono y con el
// canal de Android que ya quedó arriba.

// ─── PENDIENTE ───────────────────────────────────────────
// Estas son notificaciones LOCALES con disparador diario fijo: se lanzan aunque
// el usuario ya haya entrenado hoy, aunque sea su día de descanso o aunque esté
// lesionado. Para eso haría falta reprogramarlas cada día con el estado real
// (o mover el recordatorio a push desde el servidor, que sí conoce ese estado).
// Mientras tanto el texto está escrito para no sonar mal en ninguno de esos
// casos: ninguno de los mensajes asume que la persona NO entrenó.
