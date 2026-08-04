// lib/netStatus.ts
// Regla pura de "¿hay internet de verdad?", separada del hook para poder
// probarla sin arrastrar react-native al runner de tests.

/** Subconjunto de NetInfoState que nos importa (estructural, sin depender del SDK). */
export type SenalRed = {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
};

/**
 * Estar "conectado" a un wifi sin salida a internet no sirve de nada — es el
 * wifi cautivo de cualquier gimnasio. Y `isInternetReachable === null` es el
 * estado "comprobando": tratarlo como caída pintaría el banner de sin conexión
 * en cada arranque de la app.
 */
export function esUsable(s: SenalRed): boolean {
  if (s.isConnected === false) return false;
  return s.isInternetReachable !== false;
}
