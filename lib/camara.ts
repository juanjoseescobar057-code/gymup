// lib/camara.ts
// ─────────────────────────────────────────────────────────
// Un único sitio por el que se abre la cámara o la galería.
//
// Antes cada pantalla llamaba a expo-image-picker por su cuenta, y de las cinco
// que lo hacían:
//
//   • body-scan y progress no capturaban NADA. Al fallar quedaba una promesa
//     rechazada sin dueño: tocabas el botón y no pasaba nada, sin mensaje.
//   • fridge-scan y food-scan hacían `Alert.alert('Error', e.message)`, o sea
//     que le enseñaban a alguien que quiere fotografiar su nevera un
//     "java.lang.IllegalStateException: Attempting to launch an unregistered
//     ActivityResultLauncher with contract expo.modules.imagepicker..."
//
// El fallo que lo destapó es real y de producción (Redmi, Android 15, build 23):
// Android destruye la Activity de la app cuando necesita memoria —MIUI y
// HyperOS lo hacen con ganas— y al volver, el lanzador de resultados de
// expo-image-picker ya no está registrado. La siguiente foto revienta.
//
// No se puede arreglar desde JavaScript: el registro es nativo y ocurre al
// crearse la Activity. Lo que sí se puede es no mentirle a nadie sobre lo que
// pasó y ofrecer la salida que sigue funcionando — la galería usa otro contrato
// y sobrevive a este caso más a menudo que la cámara.
// ─────────────────────────────────────────────────────────

import * as ImagePicker from 'expo-image-picker';
import { captureError } from './monitoring';

export type ResultadoFoto =
  | { estado: 'ok'; uri: string }
  | { estado: 'cancelado' }
  | { estado: 'error'; titulo: string; mensaje: string; ofrecerGaleria: boolean };

/**
 * La Activity murió y el lanzador se quedó sin registrar.
 *
 * Se compara contra el texto porque es lo único que llega: expo envuelve la
 * excepción de Java en un CodedError cuyo `code` es genérico.
 */
function esLanzadorNoRegistrado(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /unregistered ActivityResultLauncher/i.test(msg);
}

function traducir(e: unknown, origen: 'camara' | 'galeria'): ResultadoFoto {
  captureError(e, { scope: 'camara', origen });

  if (esLanzadorNoRegistrado(e)) {
    return {
      estado: 'error',
      titulo: 'Android cerró la app por detrás',
      mensaje:
        'Tu teléfono cerró Rityvo en segundo plano y la cámara se quedó a medias. ' +
        'Ciérrala del todo y vuelve a abrirla, o usa una foto que ya tengas.',
      // La galería usa otro contrato nativo: en este caso concreto suele seguir
      // funcionando aunque la cámara no.
      ofrecerGaleria: origen === 'camara',
    };
  }

  return {
    estado: 'error',
    titulo: origen === 'camara' ? 'No pudimos abrir la cámara' : 'No pudimos abrir tus fotos',
    mensaje: 'Inténtalo de nuevo. Si vuelve a pasar, cierra la app y ábrela otra vez.',
    ofrecerGaleria: origen === 'camara',
  };
}

const POR_DEFECTO: ImagePicker.ImagePickerOptions = {
  quality: 0.85,
  mediaTypes: ['images'],
};

/** Abre la cámara. Pide permiso primero y NUNCA falla en silencio. */
export async function tomarFoto(
  opciones: ImagePicker.ImagePickerOptions = {}
): Promise<ResultadoFoto> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      return {
        estado: 'error',
        titulo: 'Permiso necesario',
        mensaje:
          'Rityvo necesita acceso a la cámara para esto. Puedes dárselo desde los ajustes ' +
          'de Android, o elegir una foto que ya tengas.',
        ofrecerGaleria: true,
      };
    }
    const r = await ImagePicker.launchCameraAsync({ ...POR_DEFECTO, ...opciones });
    if (r.canceled || !r.assets?.[0]) return { estado: 'cancelado' };
    return { estado: 'ok', uri: r.assets[0].uri };
  } catch (e) {
    return traducir(e, 'camara');
  }
}

/** Abre la galería. Mismo contrato que tomarFoto. */
export async function elegirDeGaleria(
  opciones: ImagePicker.ImagePickerOptions = {}
): Promise<ResultadoFoto> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      return {
        estado: 'error',
        titulo: 'Permiso necesario',
        mensaje: 'Rityvo necesita acceso a tus fotos para esto.',
        ofrecerGaleria: false,
      };
    }
    const r = await ImagePicker.launchImageLibraryAsync({ ...POR_DEFECTO, ...opciones });
    if (r.canceled || !r.assets?.[0]) return { estado: 'cancelado' };
    return { estado: 'ok', uri: r.assets[0].uri };
  } catch (e) {
    return traducir(e, 'galeria');
  }
}

/**
 * Enseña el error de forma que se pueda hacer algo con él.
 *
 * Va aquí y no en cada pantalla porque el fallo original fue precisamente que
 * cada pantalla improvisaba: dos enseñaban la excepción de Java y dos no
 * enseñaban nada.
 */
export function avisarError(
  r: Extract<ResultadoFoto, { estado: 'error' }>,
  usarGaleria?: () => void
): void {
  const { Alert } = require('react-native');
  Alert.alert(
    r.titulo,
    r.mensaje,
    r.ofrecerGaleria && usarGaleria
      ? [
          { text: 'Elegir de mis fotos', onPress: usarGaleria },
          { text: 'Cerrar', style: 'cancel' },
        ]
      : [{ text: 'Entendido' }]
  );
}
