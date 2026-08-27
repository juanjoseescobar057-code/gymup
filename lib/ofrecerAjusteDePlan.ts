// lib/ofrecerAjusteDePlan.ts
// ─────────────────────────────────────────────────────────
// Ajustar el plan con IA: generar, ENSEÑAR QUÉ CAMBIA, y aplicar solo si la
// persona lo confirma.
//
// Vive aquí y no en una pantalla porque ahora hay dos sitios que lo ofrecen —
// Perfil y el final de un análisis corporal— y en este repositorio ya han
// aparecido tres fallos de la misma familia: algo cableado en dos archivos y
// olvidado en el tercero. Con una sola implementación no hay tercero.
//
// El plan que se sustituye guía semanas de entrenamiento, así que el orden
// importa: primero se genera, después se enseña el diff, y solo entonces se
// escribe. Nada cambia hasta la confirmación, y el anterior queda restaurable.
// ─────────────────────────────────────────────────────────

import { regenerateAdaptivePlan, saveAdaptedPlan } from './adaptivePlan';
import { planChangePreview } from './planDiff';
import { track } from './analytics';
import type { UserProfile, WeeklyPlan } from './supabase';

type Opciones = {
  profile: UserProfile;
  planActual: WeeklyPlan;
  /** refined_plan_notes del último análisis corporal, si el ajuste sale de ahí. */
  notasCorporales?: string | null;
  /** De dónde salió la petición. Solo para analítica. */
  origen: 'perfil' | 'analisis_corporal';
  /** Se llama con el plan ya guardado, para que la pantalla refresque su estado. */
  onAplicado: (planGuardado: any) => void;
  /** Empieza y termina el indicador de carga de la pantalla. */
  onCargando?: (cargando: boolean) => void;
};

/**
 * Devuelve cuando el flujo termina (aplicado, cancelado o fallido).
 * NUNCA lanza: los errores se le enseñan a la persona.
 */
export async function ofrecerAjusteDePlan(o: Opciones): Promise<void> {
  const { Alert } = require('react-native');
  const Haptics = require('expo-haptics');

  o.onCargando?.(true);
  let nuevo: WeeklyPlan;
  try {
    nuevo = await regenerateAdaptivePlan(o.profile as any, o.planActual, o.notasCorporales ?? null);
  } catch (e: any) {
    o.onCargando?.(false);
    Alert.alert('No pudimos ajustar tu plan', e?.message ?? 'Inténtalo de nuevo en un momento.');
    return;
  }
  o.onCargando?.(false);

  const preview = planChangePreview(o.planActual, nuevo);
  const cambios = preview.split('\n').length;
  track('plan_adaptation_previewed', { changes: cambios, origen: o.origen });

  // El diff se enseña SIEMPRE, venga de donde venga. Aplicar un plan nuevo sin
  // que la persona vea qué cambia es cambiarle el entrenamiento de la semana
  // por la espalda.
  const encabezado =
    o.origen === 'analisis_corporal'
      ? 'Esto es lo que cambiaría tu plan según lo que se vio en tus fotos:'
      : 'Revisa antes de aplicar';

  await new Promise<void>((resolve) => {
    Alert.alert(
      encabezado,
      `${preview}\n\nNada cambiará hasta que lo confirmes. Podrás deshacerlo después.`,
      [
        {
          text: 'Conservar mi plan',
          style: 'cancel',
          onPress: () => {
            track('plan_adaptation_declined', { origen: o.origen });
            resolve();
          },
        },
        {
          text: 'Aplicar cambios',
          onPress: async () => {
            o.onCargando?.(true);
            try {
              const guardado = await saveAdaptedPlan(o.profile.user_id, nuevo);
              o.onAplicado(guardado);
              track('plan_adaptation_applied', { changes: cambios, origen: o.origen });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert(
                'Plan actualizado',
                'El ajuste está activo. Si no te funciona, puedes restaurar el anterior desde Perfil.'
              );
            } catch (e: any) {
              Alert.alert('No se pudo aplicar', e?.message ?? 'Intenta de nuevo.');
            } finally {
              o.onCargando?.(false);
              resolve();
            }
          },
        },
      ]
    );
  });
}
