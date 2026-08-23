// lib/useRecuperacion.ts
// ─────────────────────────────────────────────────────────
// La única forma correcta de leer el modo recuperación desde una pantalla.
//
// Leer `store.recuperacion` a secas era el fallo: esa bandera arranca en NEUTRO,
// que es exactamente lo mismo que devuelve modoRecuperacion(null). O sea que
// «todavía no lo sé» y «sé que no tiene nada» eran EL MISMO VALOR, y el arranque
// de la app no espera a nadie — navega y punto. Quien acababa de declarar un
// trastorno de la conducta alimentaria veía el anillo de calorías, su peso y el
// botón de escanear el cuerpo durante toda la ventana de la consulta.
//
// Este hook devuelve las banderas EFECTIVAS: mientras no se sepa, todo lo
// sensible sale oculto. Falla cerrado, igual que la compuerta clínica del
// entreno, y por el mismo motivo: el error de esconderle a alguien sus calorías
// medio segundo de más se corrige solo; el de enseñárselas a quien no debe, no.
// ─────────────────────────────────────────────────────────

import { useUserStore } from '../store/userStore';
import { modoRecuperacion, type ModoRecuperacion } from './recoveryMode';

/** Todo oculto. Es lo que se aplica mientras no sepamos qué declaró la persona. */
const MIENTRAS_NO_SE_SEPA: ModoRecuperacion = modoRecuperacion({
  conditions: ['trastorno_alimentario'],
  injuries: [],
} as never);

/**
 * Las banderas del modo recuperación, ya resueltas contra el estado de carga.
 *
 * Úsalo SIEMPRE en vez de `useUserStore(s => s.recuperacion)`.
 * __tests__/recoveryModeAcceso.test.ts falla si alguna pantalla lee la bandera
 * cruda.
 */
export function useRecuperacion(): ModoRecuperacion {
  const modo = useUserStore((s: any) => s.recuperacion);
  const estado = useUserStore((s: any) => s.saludEstado);
  return estado === 'conocido' ? modo : MIENTRAS_NO_SE_SEPA;
}

/**
 * Igual que el anterior, pero además dice si ya se sabe.
 *
 * Lo necesita el guardia de ruta, que tiene que distinguir «esto está en pausa
 * porque lo declaraste» de «espera, estamos comprobando»: son dos pantallas
 * distintas y confundirlas se lee como un fallo de la app.
 */
export function useEstadoSalud(): 'cargando' | 'conocido' | 'desconocido' {
  return useUserStore((s: any) => s.saludEstado);
}
