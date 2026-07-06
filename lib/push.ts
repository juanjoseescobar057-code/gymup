// lib/push.ts
// ─────────────────────────────────────────────────────────
// Registro de Expo Push token para notificaciones remotas.
// Se guarda por dispositivo en push_tokens. Si falta el projectId
// (proyecto EAS no inicializado), no rompe: simplemente no registra.
// ─────────────────────────────────────────────────────────

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export async function registerForPushNotifications(userId: string): Promise<void> {
  if (!Device.isDevice) return; // no funciona en simulador

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
    // El opt-in de push es EL predictor de retención #1 en apps de hábito.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('./analytics').track('notification_permission', { granted: status === 'granted' });
    } catch {}
  }
  if (status !== 'granted') return;

  const projectId =
    (Constants.expoConfig as any)?.extra?.eas?.projectId ??
    (Constants as any)?.easConfig?.projectId;
  if (!projectId) {
    console.log('[push] Sin projectId de EAS — corre `eas init` para activar push remoto.');
    return;
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from('push_tokens').upsert({
      token,
      user_id: userId,
      platform: Platform.OS,
      updated_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.log('[push] Error obteniendo/guardando token:', e?.message);
  }
}
