import type { WeeklyPlan } from './supabase';

export type PlanChange = { day: string; exercise: string; change: string };

export function summarizePlanChanges(before: WeeklyPlan, after: WeeklyPlan): PlanChange[] {
  const changes: PlanChange[] = [];
  for (let dayIndex = 0; dayIndex < Math.max(before.days.length, after.days.length); dayIndex++) {
    const a = before.days[dayIndex];
    const b = after.days[dayIndex];
    const day = b?.day_name ?? a?.day_name ?? `Día ${dayIndex + 1}`;
    const oldExercises = a?.exercises ?? [];
    const newExercises = b?.exercises ?? [];

    // Emparejar por NOMBRE, no por posición. Con el emparejamiento por índice,
    // que la IA quitara el primer ejercicio del día producía un resumen falso:
    // decía "Press banca → Curl bíceps · series 4 → 3" y luego "Retirado" del
    // curl, cuando lo único que pasó es que se retiró el press y el curl quedó
    // igual. Y ese resumen es lo ÚNICO que la persona lee antes de aceptar
    // sobrescribir el plan que va a guiar sus próximas semanas.
    const clave = (n: string) => n.trim().toLocaleLowerCase('es');
    const restantes = new Map<string, number>();
    newExercises.forEach((e: any, i: number) => {
      if (!restantes.has(clave(e.name))) restantes.set(clave(e.name), i);
    });

    const emparejados = new Set<number>();
    for (const oldEx of oldExercises) {
      const idx = restantes.get(clave(oldEx.name));
      if (idx === undefined) {
        changes.push({ day, exercise: oldEx.name, change: 'Retirado' });
        continue;
      }
      restantes.delete(clave(oldEx.name));
      emparejados.add(idx);
      const newEx = newExercises[idx];
      const parts: string[] = [];
      if (oldEx.name !== newEx.name) parts.push(`${oldEx.name} → ${newEx.name}`);
      if (oldEx.sets !== newEx.sets) parts.push(`series ${oldEx.sets} → ${newEx.sets}`);
      if (oldEx.reps !== newEx.reps) parts.push(`reps ${oldEx.reps} → ${newEx.reps}`);
      if ((oldEx.target_rir ?? null) !== (newEx.target_rir ?? null)) parts.push(`RIR ${oldEx.target_rir ?? '—'} → ${newEx.target_rir ?? '—'}`);
      if ((oldEx.intensity_method ?? 'none') !== (newEx.intensity_method ?? 'none')) {
        parts.push(newEx.intensity_method === 'drop_set' ? 'dropset solo en la última serie' : 'sin técnica de intensidad');
      }
      if (parts.length) changes.push({ day, exercise: newEx.name, change: parts.join(' · ') });
    }

    // Lo que quedó sin emparejar en el plan nuevo es genuinamente añadido.
    newExercises.forEach((e: any, i: number) => {
      if (!emparejados.has(i)) changes.push({ day, exercise: e.name, change: 'Añadido' });
    });
  }
  return changes;
}

export function planChangePreview(before: WeeklyPlan, after: WeeklyPlan, maxLines = 8): string {
  const changes = summarizePlanChanges(before, after);
  if (!changes.length) return 'No hay cambios materiales en ejercicios, series, repeticiones, RIR o técnicas.';
  const shown = changes.slice(0, maxLines).map((c) => `• ${c.day}: ${c.change}`);
  if (changes.length > maxLines) shown.push(`• …y ${changes.length - maxLines} cambios más`);
  return shown.join('\n');
}
