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

/**
 * Al cerrar sesión, el token de ESTE dispositivo deja de pertenecer a la
 * cuenta. Se quedaba en push_tokens: la siguiente persona que entrara en el
 * mismo teléfono recibía los avisos de reactivación de la anterior.
 *
 * Hay que llamarlo ANTES de signOut: después ya no hay sesión con la que
 * pasar el RLS. Si falla, no bloquea nada — el token se vuelve a registrar
 * en el siguiente inicio de sesión y el viejo se pisa por upsert.
 */
export async function olvidarPushToken(): Promise<void> {
  try {
    const projectId =
      (Constants.expoConfig as any)?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;
    if (!projectId) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from('push_tokens').delete().eq('token', token);
  } catch (e: any) {
    console.log('[push] No se pudo olvidar el token:', e?.message);
  }
}
