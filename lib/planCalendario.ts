// lib/planCalendario.ts
// ─────────────────────────────────────────────────────────
// QUÉ TOCA HOY. Lógica pura, sin red y sin fechas implícitas: la de hoy entra
// como parámetro para que se pueda probar cualquier escenario.
//
// EL PROBLEMA QUE RESUELVE
// `user_profiles.current_plan_day` es un CONTADOR, y solo lo movía
// app/workout-session.tsx al terminar un entrenamiento:
//
//     const nextDay = ((profile.current_plan_day ?? 0) + 1) % 7;
//
// O sea que el plan no avanzaba con el calendario, sino con la voluntad. Si
// alguien paraba diez días, al volver le esperaba exactamente el mismo día que
// dejó — y si ese día era de descanso, la app le proponía descansar después de
// diez días sin entrenar. Justo lo contrario de lo que necesita.
//
// EL MODELO
// El plan es un ciclo de siete días que corre con el calendario, anclado en el
// último entrenamiento REALIZADO. Se ancla ahí y no en la fecha de creación
// del plan porque es el único punto del que se sabe con certeza en qué día del
// ciclo estaba la persona.
//
// Dos correcciones sobre el calendario puro, y las dos importan:
//   • Volver de una pausa larga no puede caer en descanso. Quien lleva días
//     parado no necesita descansar, necesita volver.
//   • Volver no es seguir donde lo dejaste. El cuerpo se desentrena, y
//     proponer las mismas cargas de hace tres semanas es cómo se lesiona la
//     gente al reincorporarse.
// ─────────────────────────────────────────────────────────

/**
 * Los tres tipos que permite el plan (ver lib/planJsonSchema.ts).
 *
 * `active_recovery` es un día SIN entrenamiento: caminar, estirar, moverse
 * suave. Tratarlo como día de entreno fue un bug real — a alguien que llevaba
 * diez días parado la app le decía arriba "vuelve, baja un 10% el peso" y
 * abajo le proponía una caminata de 25 minutos. Los dos mensajes se
 * contradecían en la misma pantalla.
 */
export type TipoDeDia = 'workout' | 'rest' | 'active_recovery';

/** Días parado a partir de los cuales volver no puede caer en un día sin entrenar. */
export const DIAS_PARA_SALTAR_DESCANSO = 3;

/** ¿Se entrena de verdad este día? Solo 'workout' cuenta. */
function esDiaDeEntreno(t: TipoDeDia | undefined): boolean {
  return t === 'workout';
}

export type Reincorporacion = {
  diasFuera: number;
  /** Multiplicador sobre la carga habitual. 1 = sin cambios. */
  factorCarga: number;
  /** Qué decirle, en una línea. */
  nota: string;
  /** A partir de aquí el plan entero se queda viejo, no solo las cargas. */
  sugerirReplanificar: boolean;
};

export type EstadoDelDia = {
  /** Índice 0..6 del día que toca HOY. */
  diaDelPlan: number;
  /** true en 'rest' Y en 'active_recovery': ninguno de los dos es entrenar. */
  esDescanso: boolean;
  /** null cuando no hay ningún entrenamiento registrado todavía. */
  diasSinEntrenar: number | null;
  /** Cuántos días avanzó el plan desde la última vez. 0 = mismo día. */
  diasAvanzados: number;
  /** Se saltó un descanso porque volvía de una pausa. */
  saltoDescanso: boolean;
  reincorporacion: Reincorporacion | null;
};

/** Diferencia en días entre dos fechas ISO, contando solo la parte de fecha. */
export function diasEntre(desdeISO: string, hastaISO: string): number {
  const a = Date.parse(desdeISO.slice(0, 10));
  const b = Date.parse(hastaISO.slice(0, 10));
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Cuánto bajar la carga al volver, y cuándo el plan ya no sirve.
 *
 * Los tramos son deliberadamente conservadores. La pérdida de fuerza tras unas
 * semanas parado es menor de lo que la gente cree, pero la de tolerancia al
 * volumen —y con ella el dolor muscular y el riesgo— es mucho mayor. Bajar de
 * más cuesta una sesión fácil; quedarse corto cuesta una lesión y el abandono.
 */
export function reincorporacionPor(diasFuera: number): Reincorporacion | null {
  if (diasFuera < 7) return null;

  if (diasFuera < 14) {
    return {
      diasFuera,
      factorCarga: 0.9,
      nota: 'Llevas más de una semana parado. Hoy baja un 10% el peso y quédate con una repetición de reserva.',
      sugerirReplanificar: false,
    };
  }
  if (diasFuera < 28) {
    return {
      diasFuera,
      factorCarga: 0.8,
      nota: 'Llevas más de dos semanas parado. Baja un 20% el peso esta semana: en dos sesiones vuelves donde estabas.',
      sugerirReplanificar: false,
    };
  }
  return {
    diasFuera,
    factorCarga: 0.7,
    nota: 'Llevas más de un mes parado. Empieza al 70% y sube poco a poco; tu plan también merece una revisión.',
    sugerirReplanificar: true,
  };
}

/**
 * Qué día del plan toca hoy.
 *
 * `diaGuardado` es user_profiles.current_plan_day, que tras completar un
 * entrenamiento ya apunta al SIGUIENTE día. Por eso el mismo día del último
 * entreno se devuelve tal cual, y a partir del día siguiente se suma el
 * calendario.
 */
export function estadoDelDia(args: {
  hoyISO: string;
  /** Fecha del último entrenamiento COMPLETADO. null = nunca entrenó. */
  ultimoEntrenoISO: string | null;
  diaGuardado: number;
  /** Tipos de los 7 días del plan. */
  dias: TipoDeDia[];
}): EstadoDelDia {
  const total = args.dias.length;

  // Sin plan no hay nada que calcular. Devolver el día 0 y no reventar.
  if (total === 0) {
    return {
      diaDelPlan: 0,
      esDescanso: false,
      diasSinEntrenar: null,
      diasAvanzados: 0,
      saltoDescanso: false,
      reincorporacion: null,
    };
  }

  const base = ((args.diaGuardado % total) + total) % total; // tolera negativos y desbordes

  // Nunca entrenó: el plan no ha empezado, así que no corre. Mostrarle el día 3
  // a quien no ha hecho el 1 no ayuda a nadie.
  if (!args.ultimoEntrenoISO) {
    return {
      diaDelPlan: base,
      esDescanso: !esDiaDeEntreno(args.dias[base]),
      diasSinEntrenar: null,
      diasAvanzados: 0,
      saltoDescanso: false,
      reincorporacion: null,
    };
  }

  const diasSinEntrenar = Math.max(0, diasEntre(args.ultimoEntrenoISO, args.hoyISO));

  // El mismo día del entreno, `diaGuardado` ya apunta a mañana: se respeta.
  // Del día siguiente en adelante corre el calendario.
  const diasAvanzados = Math.max(0, diasSinEntrenar - 1);
  let dia = (base + diasAvanzados) % total;
  let saltoDescanso = false;

  // Volver de una pausa no puede caer en un día sin entrenar — ni descanso ni
  // recuperación activa. Quien lleva días parado no necesita una caminata
  // suave: necesita volver a entrenar, con la carga bajada.
  //
  // Se comprueba `!esDiaDeEntreno` y no `=== 'rest'` a propósito: esa
  // comparación se dejó fuera a 'active_recovery' y produjo el bug de la
  // pantalla que se contradecía a sí misma.
  if (diasSinEntrenar >= DIAS_PARA_SALTAR_DESCANSO && !esDiaDeEntreno(args.dias[dia])) {
    for (let i = 1; i <= total; i++) {
      const candidato = (dia + i) % total;
      if (esDiaDeEntreno(args.dias[candidato])) {
        dia = candidato;
        saltoDescanso = true;
        break;
      }
    }
  }

  return {
    diaDelPlan: dia,
    esDescanso: !esDiaDeEntreno(args.dias[dia]),
    diasSinEntrenar,
    diasAvanzados,
    saltoDescanso,
    reincorporacion: reincorporacionPor(diasSinEntrenar),
  };
}
