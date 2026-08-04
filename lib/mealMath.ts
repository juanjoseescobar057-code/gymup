// lib/mealMath.ts
// Reglas puras del registro de comida. Separadas de logMeal.ts (que arrastra
// Supabase y notificaciones) para que se puedan probar de verdad: son las dos
// decisiones que mueven XP y mandan avisos al teléfono de alguien.

export type MacrosComida = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export type TotalesDia = MacrosComida;

export type MetasDia = {
  daily_calories: number;
  daily_protein_g: number;
  daily_carbs_g: number;
  daily_fat_g: number;
};

/**
 * ¿Esta comida completa las CUATRO metas del día? Se calcula sobre los totales
 * previos + la comida nueva. Es una decisión de producto explícita: cubrir
 * calorías pero quedarse corto en proteína no es un día de macros cumplido.
 */
export function completaMacrosDelDia(previos: TotalesDia, nueva: MacrosComida, metas: MetasDia): boolean {
  return (
    previos.calories + nueva.calories >= metas.daily_calories &&
    previos.protein_g + nueva.protein_g >= metas.daily_protein_g &&
    previos.carbs_g + nueva.carbs_g >= metas.daily_carbs_g &&
    previos.fat_g + nueva.fat_g >= metas.daily_fat_g
  );
}

/** Calorías implícitas en los macros: 4 kcal/g proteína y carbos, 9 kcal/g grasa. */
export function caloriasDesdeMacros(m: Pick<MacrosComida, 'protein_g' | 'carbs_g' | 'fat_g'>): number {
  return m.protein_g * 4 + m.carbs_g * 4 + m.fat_g * 9;
}

/**
 * Entrada manual: qué se puede guardar y qué no.
 *
 * Regla de fondo: el registro manual NO puede ser más permisivo que el
 * escaneo. Si aquí entrara una comida de 0 kcal o con macros negativos, los
 * totales del día y el XP quedarían inservibles — y encima serían datos
 * metidos por el propio usuario, imposibles de distinguir de un fallo de la IA.
 *
 * El desajuste entre calorías y macros NO bloquea: mucha gente copia el número
 * del paquete, que redondea. Se avisa y ya; decidir es del usuario.
 */
export type ValidacionComida = {
  ok: boolean;
  errores: Record<string, string>;
  /** Aviso no bloqueante, o null. */
  aviso: string | null;
};

export function validarComidaManual(v: {
  nombre: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}): ValidacionComida {
  const errores: Record<string, string> = {};

  if (!v.nombre.trim()) errores.nombre = 'Ponle un nombre para reconocerla después.';

  const campos: [keyof typeof v, string][] = [
    ['calories', 'Calorías'], ['protein_g', 'Proteína'], ['carbs_g', 'Carbos'], ['fat_g', 'Grasa'],
  ];
  for (const [k, label] of campos) {
    const n = v[k] as number;
    if (!Number.isFinite(n)) errores[k as string] = `${label}: escribe un número.`;
    else if (n < 0) errores[k as string] = `${label} no puede ser negativa.`;
  }

  if (!errores.calories && v.calories <= 0) {
    errores.calories = 'Una comida de 0 calorías no se puede registrar.';
  }

  let aviso: string | null = null;
  if (Object.keys(errores).length === 0) {
    const implicitas = caloriasDesdeMacros(v);
    // Solo se compara si hay macros que comparar; una comida con macros en
    // cero es un registro rápido "a ojo", no un error.
    if (implicitas > 0) {
      const desvio = Math.abs(implicitas - v.calories) / v.calories;
      if (desvio > 0.25) {
        aviso = `Tus macros suman unas ${Math.round(implicitas)} kcal y escribiste ${Math.round(v.calories)}. ` +
          'Puedes guardarlo igual; revísalo si fue un error de dedo.';
      }
    }
  }

  return { ok: Object.keys(errores).length === 0, errores, aviso };
}

export type AvisoProteina = { title: string; body: string } | null;

/**
 * Aviso de proteína. Reporta el hecho y lo que falta; no felicita ni regaña a
 * la persona por lo que comió. Por debajo del 80% no se dice nada: un aviso
 * en cada bocado es ruido, no ayuda.
 */
export function avisoProteina(proteinaTotal: number, meta: number): AvisoProteina {
  const pct = (proteinaTotal / Math.max(meta, 1)) * 100;
  if (pct >= 100) {
    return {
      title: '🎯 Meta de proteína cubierta',
      body: `Llevas ${Math.round(proteinaTotal)}g de proteína de tus ${Math.round(meta)}g de hoy.`,
    };
  }
  if (pct >= 80) {
    return {
      title: '💪 Cerca de tu meta de proteína',
      body: `Te faltan ${Math.round(meta - proteinaTotal)}g. Un batido o un par de huevos aportan una cantidad parecida.`,
    };
  }
  return null;
}
