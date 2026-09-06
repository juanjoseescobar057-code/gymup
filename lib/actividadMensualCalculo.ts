// lib/actividadMensualCalculo.ts
// ─────────────────────────────────────────────────────────
// La parte PURA de "tu mes": rejilla del calendario, resumen y etiquetas.
// Sin supabase ni react-native, para poder probarla desde node. La lectura
// vive en lib/actividadMensual.ts.
//
// El "día" es el del teléfono (new Date(iso).getDate()), igual que
// localDateKey() en el resto de la app: lo que la persona ve como martes es
// martes aunque el servidor lo guardara en UTC.
// ─────────────────────────────────────────────────────────

export type SesionDelMes = {
  id: string;
  completed_at: string;
  duration_min: number | null;
  exercises_completed: number | null;
  day_index: number | null;
};

export type SerieDelMes = {
  exercise_name: string;
  weight_kg: number | null;
  reps: number | null;
  logged_at: string;
  session_id: string | null;
};

export type EjercicioDelMes = {
  nombre: string;
  series: number;
  /** Días distintos en que se hizo. */
  dias: number;
  volumenKg: number;
  /** La serie más pesada del mes (empate: más repeticiones). */
  mejor: { peso: number; reps: number } | null;
};

export type DiaDelMes = {
  entrenos: number;
  minutos: number;
  ejercicios: string[];
};

export type ResumenMes = {
  anio: number;
  mes: number; // 0-11
  entrenos: number;
  minutos: number;
  series: number;
  volumenKg: number;
  /** Entrenos por semana, a un decimal, sobre las semanas reales del mes. */
  porSemana: number;
  diasEntrenados: number[];
  porDia: Record<number, DiaDelMes>;
  ejercicios: EjercicioDelMes[];
};

export const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** Cabecera del calendario. La semana empieza en lunes, como en Colombia. */
export const DIAS_CORTOS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export function diasDelMes(anio: number, mes: number): number {
  return new Date(anio, mes + 1, 0).getDate();
}

/**
 * Semanas del mes como filas de 7 celdas: número de día o null (relleno).
 * Lunes primero: el getDay() de JS empieza en domingo y se rota.
 */
export function rejillaDelMes(anio: number, mes: number): (number | null)[][] {
  const desplazamiento = (new Date(anio, mes, 1).getDay() + 6) % 7;
  const total = diasDelMes(anio, mes);
  const celdas: (number | null)[] = Array(desplazamiento).fill(null);
  for (let d = 1; d <= total; d++) celdas.push(d);
  while (celdas.length % 7 !== 0) celdas.push(null);
  const filas: (number | null)[][] = [];
  for (let i = 0; i < celdas.length; i += 7) filas.push(celdas.slice(i, i + 7));
  return filas;
}

export function esDelMes(iso: string, anio: number, mes: number): boolean {
  const d = new Date(iso);
  return d.getFullYear() === anio && d.getMonth() === mes;
}

export function resumirMes(
  sesiones: SesionDelMes[],
  series: SerieDelMes[],
  anio: number,
  mes: number,
  /**
   * Días del mes que ya han PASADO. Solo importa en el mes en curso, que es el
   * que la pantalla abre por defecto: dividir los entrenos del día 3 entre las
   * 4,4 semanas del mes entero daba "0,7 por semana" a alguien que llevaba
   * tres entrenos en tres días. Por omisión, el mes completo.
   */
  diasContados?: number,
): ResumenMes {
  const porDia: Record<number, DiaDelMes> = {};
  const dia = (n: number) => (porDia[n] ??= { entrenos: 0, minutos: 0, ejercicios: [] });

  let entrenos = 0;
  let minutos = 0;
  for (const s of sesiones) {
    if (!s.completed_at || !esDelMes(s.completed_at, anio, mes)) continue;
    const d = dia(new Date(s.completed_at).getDate());
    d.entrenos += 1;
    d.minutos += s.duration_min ?? 0;
    entrenos += 1;
    minutos += s.duration_min ?? 0;
  }

  let totalSeries = 0;
  let volumenKg = 0;
  const porEjercicio = new Map<string, { series: number; dias: Set<number>; volumenKg: number; mejor: EjercicioDelMes['mejor'] }>();
  for (const r of series) {
    if (!esDelMes(r.logged_at, anio, mes)) continue;
    if (r.weight_kg == null && r.reps == null) continue; // serie vacía: no cuenta
    const numDia = new Date(r.logged_at).getDate();
    const nombre = r.exercise_name;
    const e = porEjercicio.get(nombre) ?? { series: 0, dias: new Set<number>(), volumenKg: 0, mejor: null };
    e.series += 1;
    e.dias.add(numDia);
    totalSeries += 1;
    if (r.weight_kg != null && r.reps != null) {
      const vol = r.weight_kg * r.reps;
      e.volumenKg += vol;
      volumenKg += vol;
      if (
        !e.mejor
        || r.weight_kg > e.mejor.peso
        || (r.weight_kg === e.mejor.peso && r.reps > e.mejor.reps)
      ) {
        e.mejor = { peso: r.weight_kg, reps: r.reps };
      }
    }
    porEjercicio.set(nombre, e);
    const d = dia(numDia);
    if (!d.ejercicios.includes(nombre)) d.ejercicios.push(nombre);
  }

  const ejercicios: EjercicioDelMes[] = [...porEjercicio.entries()]
    .map(([nombre, e]) => ({
      nombre,
      series: e.series,
      dias: e.dias.size,
      volumenKg: Math.round(e.volumenKg),
      mejor: e.mejor,
    }))
    .sort((a, b) => b.series - a.series || b.dias - a.dias || a.nombre.localeCompare(b.nombre));

  // Un día cuenta como día de gimnasio si hay sesión terminada O si hay series
  // registradas. Solo con sesiones terminadas, quien empieza un entreno,
  // registra tres series y lo abandona veía sus series sumadas en los totales
  // y el día en blanco en el calendario: la pantalla se contradecía sola.
  const diasEntrenados = Object.keys(porDia)
    .map(Number)
    .filter((n) => porDia[n].entrenos > 0 || porDia[n].ejercicios.length > 0)
    .sort((a, b) => a - b);

  const totalDias = diasDelMes(anio, mes);
  const transcurridos = Math.max(1, Math.min(diasContados ?? totalDias, totalDias));
  const semanas = transcurridos / 7;

  return {
    anio,
    mes,
    entrenos,
    minutos,
    series: totalSeries,
    volumenKg: Math.round(volumenKg),
    porSemana: Math.round((entrenos / semanas) * 10) / 10,
    diasEntrenados,
    porDia,
    ejercicios,
  };
}

/** "45 min", "1 h", "8 h 40 min". */
export function etiquetaDuracion(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto === 0 ? `${h} h` : `${h} h ${resto} min`;
}

/** "12 400 kg" — miles con espacio, como se escribe en Colombia. */
export function etiquetaKg(kg: number): string {
  return `${Math.round(kg).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} kg`;
}

/** "+3 vs agosto", "−2 vs agosto", "igual que agosto". */
export function etiquetaComparacion(actual: number, anterior: number, mesAnterior: number): string {
  const nombre = MESES[((mesAnterior % 12) + 12) % 12];
  if (actual === anterior) return `igual que ${nombre}`;
  const diff = actual - anterior;
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff)} vs ${nombre}`;
}
