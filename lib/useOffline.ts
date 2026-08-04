// lib/useOffline.ts
// ─────────────────────────────────────────────────────────
// Estado de conexión. Los gimnasios son sótanos: quedarse sin señal a mitad
// de una serie es lo normal, no el caso raro. Hasta ahora la app no lo sabía,
// así que cada fallo de red aparecía como un error genérico ("algo salió
// mal") que hacía dudar al usuario de sus datos en vez de de su cobertura.
//
// Deliberadamente NO se bloquea nada: el banner es informativo. Entrenar,
// contar reps y ver el plan cacheado funcionan sin conexión; lo que no
// funciona es lo que necesita servidor (IA, sincronizar, comprar).
//
// La regla de decisión vive en netStatus.ts (pura y con tests); aquí solo
// está la suscripción al SDK nativo.
// ─────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { esUsable } from './netStatus';

export function useOffline(): { offline: boolean; recheck: () => void } {
  // `null` = todavía no sabemos. Importa distinguirlo de `false`: mostrar
  // "Sin conexión" en el primer frame, antes de que NetInfo conteste, sería
  // una alarma falsa en cada arranque.
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => setOnline(esUsable(s)));
    NetInfo.fetch().then((s) => setOnline(esUsable(s))).catch(() => {});
    return unsub;
  }, []);

  return {
    offline: online === false,
    recheck: () => { NetInfo.fetch().then((s) => setOnline(esUsable(s))).catch(() => {}); },
  };
}
