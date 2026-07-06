// lib/notifications.ts
// ─────────────────────────────────────────────────────────
// Sistema de notificaciones motivadoras de GymUp.
//
// La idea: mensajes con PERSONALIDAD, no genéricos.
// Hay 6 situaciones distintas y cada una tiene su banco
// de mensajes propios. La IA también puede generar uno
// personalizado basado en el progreso real del usuario.
// ─────────────────────────────────────────────────────────

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { aiChatContent } from './aiClient';

// NOTA: el handler de notificaciones se configura UNA sola vez en
// app/_layout.tsx. No lo dupliques aquí (causaba conflicto de config).

// ─── BANCO DE MENSAJES POR SITUACIÓN ────────────────────
// Cada situación tiene 8+ mensajes. Se elige uno al azar.
// El tono es directo, sin filtro, pero siempre motivador.

export const NOTIFICATION_BANKS = {

  // 📵 Lleva 1+ días sin abrir la app / sin entrenar
  missed_workout: [
    {
      title: '¿Qué pasó? 👀',
      body: 'Ayer no entrenaste. Tu competencia sí lo hizo. ¿Vas a dejar que te ganen?',
    },
    {
      title: 'Tu cuerpo pregunta por ti 🏋️',
      body: 'Llevas un día sin entrenar. Los músculos que construiste ayer te están esperando.',
    },
    {
      title: 'Excusas 0 — Resultados 0 📉',
      body: 'Cada día que no entrenas es un día que le regalas a quien sí se está poniendo en forma.',
    },
    {
      title: 'Seamos honestos... 🤔',
      body: 'No entrenaste ayer. Hoy tienes dos opciones: seguir igual o cambiar el resultado.',
    },
    {
      title: '¿Recuerdas por qué empezaste? 🔥',
      body: 'Tu objetivo no desapareció. Solo se alejó un poco más. Vuelve hoy.',
    },
    {
      title: 'Dato curioso 💡',
      body: 'La persona que tiene el cuerpo que quieres tampoco tenía ganas. Pero igual fue.',
    },
    {
      title: 'Tu silla te quiere demasiado 🛋️',
      body: '...y eso es un problema. 15 minutos hoy es mejor que cero. ¿Arrancamos?',
    },
    {
      title: 'Alerta de comodidad 🚨',
      body: 'Tu zona de confort acaba de expandirse. Eso no es buena noticia para tu físico.',
    },
  ],

  // 🌅 Buenos días — hora de entrenar
  morning_workout: [
    {
      title: 'Buenos días, campeón 💪',
      body: 'Mientras tú lees esto, alguien más ya está en el gym. ¿Qué vas a hacer tú?',
    },
    {
      title: '5AM Club o 8AM Club, no importa 🌅',
      body: 'Lo que importa es que hoy entrenes. Tu cuerpo te lo va a agradecer esta noche.',
    },
    {
      title: 'La cama miente 🛏️',
      body: 'Te dice que estás cansado. Tu cuerpo dice que puede más. Confía en tu cuerpo.',
    },
    {
      title: 'Hoy es día de patas 🦵',
      body: 'La mayoría lo evita. Por eso la mayoría se ve igual. Sé diferente.',
    },
    {
      title: 'El gym abrió hace rato ⏰',
      body: 'Y hay gente construyendo el cuerpo que tú quieres. ¿Los vas a dejar solos?',
    },
    {
      title: 'Mañana de hoy en 1 mes 📅',
      body: 'Vas a estar agradecido de que hoy sí fuiste. Muévete.',
    },
  ],

  // 🍗 Le falta proteína al día
  low_protein: [
    {
      title: 'Alarma de proteína 🚨',
      body: 'Llevas el día sin suficiente proteína. Sin proteína, el músculo no crece. Así de simple.',
    },
    {
      title: 'Tus músculos están esperando 💪',
      body: 'Te faltan {X}g de proteína. Un batido o 200g de pollo y lo cierras. ¿Qué esperas?',
    },
    {
      title: 'La proteína no se toma sola 🍳',
      body: 'Llevas el día con déficit de proteína. Esta noche: huevos, pollo, atún o un shake. Escoge uno.',
    },
    {
      title: 'El músculo se construye en la mesa, no en el gym 🍽️',
      body: 'El 80% es nutrición. Sin proteína no hay resultados. Cierra el día bien.',
    },
    {
      title: 'Dato importante 📊',
      body: 'Tu objetivo requiere {X}g de proteína diarios. Hoy llevas menos de la mitad. Actúa.',
    },
  ],

  // 🔥 Racha activa — refuerzo positivo
  streak_active: [
    {
      title: '{N} días seguidos 🔥🔥',
      body: 'Eso no es suerte, eso es disciplina. Sigue así y en 30 días no vas a reconocerte.',
    },
    {
      title: '¡Racha de {N} días! 💪',
      body: 'La consistencia que tienes ahora es la que te va a dar resultados que duran. No pares.',
    },
    {
      title: 'Lleva {N} días destruyendo excusas 🏆',
      body: 'Y cada día se pone más fácil. El hábito ya está formado. Ahora es automático.',
    },
    {
      title: '🔥 {N} días. Imparable.',
      body: 'La versión de ti de hace {N} días estaría orgullosa. Sigue siendo esa persona.',
    },
  ],

  // 🎯 Está cerca de la meta del día
  almost_goal: [
    {
      title: '¡Casi! Solo faltan {X}g de proteína 🎯',
      body: 'Un yogur griego o un shake y cierras el día perfecto. Tan cerca no te rajes.',
    },
    {
      title: 'El 95% no llega a su meta diaria ❌',
      body: 'Tú estás a {X} calorías. Eres del 5%. No lo desperdicies.',
    },
    {
      title: 'Falta poco para un día 10/10 ✨',
      body: 'Te faltan {X}g de proteína. Esta noche: huevos revueltos, requesón o batido de proteína.',
    },
  ],

  // 🏆 Logro desbloqueado
  achievement: [
    {
      title: '¡Nuevo logro desbloqueado! 🏆',
      body: '{achievement}. Esto ya está en tu historial para siempre.',
    },
    {
      title: 'NIVEL SUBIDO 📈',
      body: '{achievement}. Cada semana mejor que la anterior. Así se construyen los mejores.',
    },
    {
      title: '¡Lo lograste! 🎉',
      body: '{achievement}. Ese eres tú. Nadie más lo hizo por ti.',
    },
  ],

  // 🌙 Recordatorio nocturno
  evening_check: [
    {
      title: '¿Cómo quedó tu día? 🌙',
      body: 'Registra lo que comiste y mira cómo te fue con tus macros. 2 minutos, vale la pena.',
    },
    {
      title: 'El log de hoy importa 📋',
      body: 'Lo que no se mide no mejora. Registra tu comida antes de dormir.',
    },
    {
      title: '¿Entrenaste hoy? Regístralo 💾',
      body: 'Tu historial te va a motivar cuando quieras rendirte. Nútrely desde ahora.',
    },
  ],
};

// ─── TIPOS ───────────────────────────────────────────────
export type NotificationSituation = keyof typeof NOTIFICATION_BANKS;

export type ScheduledNotification = {
  situation: NotificationSituation;
  hour: number;
  minute: number;
  variables?: Record<string, string | number>;
};

// ─── SOLICITAR PERMISOS ──────────────────────────────────
export async function requestNotificationPermissions(): Promise<boolean> {
  if (!Device.isDevice) {
    console.log('Las notificaciones solo funcionan en dispositivo real');
    return false;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('gymup', {
      name: 'GymUp Motivación',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#C8FF3E',
      sound: 'default',
    });
  }

  return finalStatus === 'granted';
}

// ─── REEMPLAZAR VARIABLES EN MENSAJES ───────────────────
function fillTemplate(
  text: string,
  variables?: Record<string, string | number>
): string {
  if (!variables) return text;
  return Object.entries(variables).reduce(
    (str, [key, val]) => str.replace(`{${key}}`, String(val)),
    text
  );
}

// ─── ELEGIR MENSAJE ALEATORIO DE UN BANCO ───────────────
function randomMessage(bank: typeof NOTIFICATION_BANKS[NotificationSituation]) {
  return bank[Math.floor(Math.random() * bank.length)];
}

// ─── ENVIAR NOTIFICACIÓN INMEDIATA ──────────────────────
export async function sendImmediateNotification(
  situation: NotificationSituation,
  variables?: Record<string, string | number>
): Promise<void> {
  const msg = randomMessage(NOTIFICATION_BANKS[situation]);

  await Notifications.scheduleNotificationAsync({
    content: {
      title: fillTemplate(msg.title, variables),
      body: fillTemplate(msg.body, variables),
      sound: 'default',
      data: { situation },
    },
    trigger: null, // inmediata
  });
}

// ─── PROGRAMAR TODAS LAS NOTIFICACIONES DEL DÍA ─────────
// Se llama al abrir la app. Cancela las anteriores y programa
// las del día según el perfil del usuario.

export async function scheduleDailyNotifications(config: {
  workoutDays: number[];      // días de la semana que entrena [1=Lun..7=Dom]
  proteinGoal: number;        // meta diaria de proteína
  currentStreak: number;      // racha actual
  wakeUpHour: number;         // hora de despertar (default 7)
  workoutHour: number;        // hora usual de entreno (default 18)
}): Promise<void> {
  // Cancelar notificaciones anteriores
  await Notifications.cancelAllScheduledNotificationsAsync();

  const today = new Date();
  const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay(); // 1-7

  const isWorkoutDay = config.workoutDays.includes(dayOfWeek);

  const toSchedule: Array<{
    content: Notifications.NotificationContentInput;
    trigger: Notifications.NotificationTriggerInput;
  }> = [];

  // 1. Motivación matutina (7:30am o 30min después del wake up)
  const morningHour = config.wakeUpHour;
  const morningMsg = isWorkoutDay
    ? randomMessage(NOTIFICATION_BANKS.morning_workout)
    : randomMessage(NOTIFICATION_BANKS.missed_workout);

  toSchedule.push({
    content: {
      title: morningMsg.title,
      body: morningMsg.body,
      sound: 'default',
      data: { situation: 'morning_workout' },
    },
    trigger: {
      hour: morningHour,
      minute: 30,
      repeats: false,
    } as any,
  });

  // 2. Recordatorio de proteína (2pm)
  const proteinMsg = randomMessage(NOTIFICATION_BANKS.low_protein);
  toSchedule.push({
    content: {
      title: fillTemplate(proteinMsg.title, { X: Math.round(config.proteinGoal * 0.4) }),
      body: fillTemplate(proteinMsg.body, { X: Math.round(config.proteinGoal * 0.4) }),
      sound: 'default',
      data: { situation: 'low_protein' },
    },
    trigger: { hour: 14, minute: 0, repeats: false } as any,
  });

  // 3. Pre-entreno si es día de gym (1h antes del entreno habitual)
  if (isWorkoutDay) {
    const preMsg = randomMessage(NOTIFICATION_BANKS.morning_workout);
    toSchedule.push({
      content: {
        title: '⚡ Es hora de ir al gym',
        body: preMsg.body,
        sound: 'default',
        data: { situation: 'morning_workout' },
      },
      trigger: {
        hour: Math.max(config.workoutHour - 1, 6),
        minute: 0,
        repeats: false,
      } as any,
    });
  }

  // 4. Check nocturno (9pm)
  const eveningMsg = randomMessage(NOTIFICATION_BANKS.evening_check);
  toSchedule.push({
    content: {
      title: eveningMsg.title,
      body: eveningMsg.body,
      sound: 'default',
      data: { situation: 'evening_check' },
    },
    trigger: { hour: 21, minute: 0, repeats: false } as any,
  });

  // 5. Racha si lleva 3+ días seguidos
  if (config.currentStreak >= 3) {
    const streakMsg = randomMessage(NOTIFICATION_BANKS.streak_active);
    toSchedule.push({
      content: {
        title: fillTemplate(streakMsg.title, { N: config.currentStreak }),
        body: fillTemplate(streakMsg.body, { N: config.currentStreak }),
        sound: 'default',
        data: { situation: 'streak_active' },
      },
      trigger: { hour: 20, minute: 0, repeats: false } as any,
    });
  }

  // Programar todas
  await Promise.all(
    toSchedule.map((n) =>
      Notifications.scheduleNotificationAsync(n).catch(console.error)
    )
  );

  console.log(`✅ ${toSchedule.length} notificaciones programadas para hoy`);
}

// ─── NOTIFICACIÓN PERSONALIZADA CON GPT-4o ──────────────
// Para ocasiones especiales: primer logro, semana perfecta, etc.
// Genera un mensaje único e irrepetible para el usuario.

export async function generatePersonalizedNotification(context: {
  userName: string;
  achievement: string;
  currentStreak: number;
  goal: string;
}): Promise<{ title: string; body: string }> {
  const prompt = `Eres el coach de GymUp, una app fitness. Genera una notificación push CORTA, motivadora y con personalidad para este usuario:

Nombre: ${context.userName}
Logro: ${context.achievement}
Racha actual: ${context.currentStreak} días
Objetivo: ${context.goal}

El tono debe ser:
- Directo y sin rodeos
- Como un amigo que te reta, no un chatbot
- Puede ser agresivo/desafiante pero siempre positivo
- Incluye emojis estratégicamente (no en exceso)
- En español colombiano natural

Ejemplos de tono (NO copies, inspírate):
- "Tu ex acaba de publicar foto en el gym. ¿Qué esperas?"
- "10 días seguidos. Eso ya no es motivación, eso es carácter."
- "La proteína no se toma sola. Son las 8pm. Actúa."

Responde SOLO con JSON:
{ "title": "máximo 40 chars", "body": "máximo 100 chars" }`;

  try {
    const content = await aiChatContent({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 100,
      temperature: 0.9,
    }, 'notification');
    return JSON.parse(content);
  } catch {
    // Fallback si falla la IA
    return {
      title: `¡${context.currentStreak} días, ${context.userName}! 🔥`,
      body: `${context.achievement}. Así se construyen los mejores.`,
    };
  }
}

// ─── NOTIFICAR LOGRO INMEDIATAMENTE ─────────────────────
export async function notifyAchievement(
  userName: string,
  achievement: string,
  streak: number,
  goal: string
): Promise<void> {
  const msg = await generatePersonalizedNotification({
    userName,
    achievement,
    currentStreak: streak,
    goal,
  });

  await Notifications.scheduleNotificationAsync({
    content: {
      title: msg.title,
      body: msg.body,
      sound: 'default',
      data: { type: 'achievement' },
    },
    trigger: null,
  });
}
