// lib/useSafeKeepAwake.ts
// ─────────────────────────────────────────────────────────
// Mantiene la pantalla encendida mientras el componente está montado
// (entrenamientos / coach en vivo). Envuelto en try/catch: si el módulo
// nativo no está en el build, simplemente no hace nada.
// ─────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

export function useSafeKeepAwake(tag = 'gymup-session'): void {
  useEffect(() => {
    activateKeepAwakeAsync(tag).catch(() => {});
    return () => {
      try {
        deactivateKeepAwake(tag);
      } catch {}
    };
  }, [tag]);
}
