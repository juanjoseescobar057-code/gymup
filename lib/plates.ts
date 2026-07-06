// lib/plates.ts
// ─────────────────────────────────────────────────────────
// Calculadora de discos: dado un peso objetivo y la barra, qué discos
// poner POR LADO. Lógica pura → testeable.
// ─────────────────────────────────────────────────────────

/** Juego de discos estándar de gimnasio (kg). */
export const STANDARD_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

export type PlateResult = {
  perSide: number[];   // discos por lado, de mayor a menor
  achieved: number;    // peso total realmente logrado (barra + discos)
  leftover: number;    // kg que no se pudieron representar (0 = exacto)
};

/**
 * Calcula los discos por lado para llegar a `targetKg` con una barra de
 * `barKg`. Greedy (funciona con juegos de discos estándar). Devuelve null
 * si el objetivo es menor que la barra.
 */
export function platesPerSide(
  targetKg: number,
  barKg = 20,
  available: number[] = STANDARD_PLATES
): PlateResult | null {
  if (!(targetKg > 0) || targetKg < barKg) return null;

  let perSideRemaining = (targetKg - barKg) / 2;
  const perSide: number[] = [];
  const sorted = [...available].sort((a, b) => b - a);

  for (const plate of sorted) {
    while (perSideRemaining >= plate - 1e-9) {
      perSide.push(plate);
      perSideRemaining = Math.round((perSideRemaining - plate) * 100) / 100;
    }
  }

  const achieved = Math.round((barKg + perSide.reduce((a, b) => a + b, 0) * 2) * 100) / 100;
  const leftover = Math.round(perSideRemaining * 2 * 100) / 100;
  return { perSide, achieved, leftover };
}

/** Texto compacto tipo "20 + 5 + 2.5 por lado". */
export function formatPlates(result: PlateResult): string {
  if (result.perSide.length === 0) return 'Solo la barra';
  return result.perSide.join(' + ') + ' por lado';
}
