// lib/dailyNotifications.ts
// ─────────────────────────────────────────────────────────
// Programa las 3 notificaciones diarias locales. Se llama cuando el
// usuario YA tiene perfil (no en el primer arranque en frío: pedir el
// permiso antes de que la app muestre valor dispara rechazos que no
// tienen recuperación).
// ─────────────────────────────────────────────────────────

import * as Notifications from 'expo-notifications';

function randomMessage(type: 'morning' | 'afternoon' | 'night'): string {
  const messages = {
    morning: [
      'Mientras lees esto, alguien más ya está en el gym. ¿Qué vas a hacer tú?',
      'La cama miente. Tu cuerpo puede más. Muévete.',
      'Hoy es día de construir el cuerpo que quieres. Arranca ya.',
      'Los que se ven bien no tuvieron más tiempo. Tuvieron más disciplina.',
      'Tu versión de hace 1 mes estaría orgullosa de lo que lograrás hoy.',
      'El gym abrió hace rato. ¿Vas a dejar que otros se pongan en forma por ti?',
    ],
    afternoon: [
      '¿Vas a dejar que los demás sí se pongan en forma y tú no?',
      'Son las 6pm. El gym cierra a las 10. Todavía hay tiempo.',
      'Cada día que no entrenas es un día que le regalas a tu competencia.',
      'Tu cuerpo está esperando. La excusa también. Tú decides cuál escuchas.',
      'No tienes que querer hacerlo. Solo tienes que hacerlo.',
      'El dolor de entrenar dura 1 hora. El arrepentimiento de no hacerlo dura todo el día.',
    ],
    night: [
      '¿Cerraste tus macros hoy? Registra lo que comiste antes de dormir.',
      'El músculo se construye de noche. La proteína también se come de noche.',
      'Antes de dormir: ¿entrenaste? ¿comiste bien? Mañana es otra oportunidad.',
      'El sueño es parte del entrenamiento. Duerme bien y mañana rompes marcas.',
      'Hoy ya pasó. Lo que hagas mañana define quién vas a ser.',
      'Registra tu comida. Lo que no se mide, no mejora.',
    ],
  };
  const list = messages[type];
  return list[Math.floor(Math.random() * list.length)];
}

export async function setupDailyNotifications(): Promise<void> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;

    await Notifications.cancelAllScheduledNotificationsAsync();

    const daily = (hour: number, minute: number): Notifications.DailyTriggerInput => ({
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    });

    await Notifications.scheduleNotificationAsync({
      content: { title: '☀️ Buenos días', body: randomMessage('morning'), sound: 'default' },
      trigger: daily(8, 0),
    });
    await Notifications.scheduleNotificationAsync({
      content: { title: '💪 ¿Ya entrenaste?', body: randomMessage('afternoon'), sound: 'default' },
      trigger: daily(18, 0),
    });
    await Notifications.scheduleNotificationAsync({
      content: { title: '🌙 Cierra el día', body: randomMessage('night'), sound: 'default' },
      trigger: daily(21, 0),
    });
  } catch (e: any) {
    console.log('[Notifications] Error:', e?.message);
  }
}
