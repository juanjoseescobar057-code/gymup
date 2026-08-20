// Components/CameraDisclosureModal.tsx
// ─────────────────────────────────────────────────────────
// Disclosure explícito antes de mandar una foto a analizar: la imagen se
// envía a un servicio de IA de terceros (OpenAI). Se muestra una sola vez
// por feature (ver lib/cameraConsent.ts).
//
// Ojo con el nombre del archivo: el aviso NO es sobre el permiso de cámara
// sino sobre que la foto sale del teléfono, así que también aplica a las
// imágenes elegidas de la galería. Por eso los textos son neutros respecto
// al origen de la imagen.
// ─────────────────────────────────────────────────────────

import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { Colors, Fonts, Radii, Spacing } from '../constants/theme';

/**
 * Qué le pasa REALMENTE a la foto. No es un detalle: de esto depende que el
 * aviso sea cierto.
 *
 *  • `ia`            → sale del teléfono hacia OpenAI y no se guarda la imagen.
 *  • `almacenamiento`→ NO va a ninguna IA, pero SÍ se guarda en la nube.
 *  • `local`         → se procesa en el propio teléfono y no sale nada.
 *
 * Antes el texto estaba fijo en el caso `ia`, así que reutilizar este modal en
 * las fotos de transformación —que sí se almacenan y no van a ninguna IA—
 * habría dicho exactamente lo contrario de lo que ocurre.
 */
export type DestinoFoto = 'ia' | 'almacenamiento' | 'local';

type Props = {
  visible: boolean;
  /** Qué se captura, ej: "tu plato" / "tu nevera" / "tu progreso". */
  subject: string;
  /** Qué le pasa a la imagen. Por defecto el caso histórico: análisis con IA. */
  destino?: DestinoFoto;
  /**
   * Título opcional. El default sirve para los dos orígenes de la imagen
   * (cámara y galería); solo se sobrescribe si una pantalla necesita otro.
   */
  title?: string;
  onAccept: () => void;
  onCancel: () => void;
};

function textoDe(destino: DestinoFoto, subject: string): string {
  switch (destino) {
    case 'almacenamiento':
      return `La foto de ${subject} se guarda en tu almacenamiento privado en la nube, ` +
        `solo tú puedes verla y puedes borrarla cuando quieras. NO se envía a ningún ` +
        `servicio de inteligencia artificial.`;
    case 'local':
      return `El análisis de ${subject} ocurre en tu propio teléfono: la imagen NO sale ` +
        `del dispositivo, no se envía a ningún servidor y no se guarda. Solo se ` +
        `conserva el conteo de repeticiones.`;
    case 'ia':
    default:
      return `La foto de ${subject} se envía a un servicio de inteligencia artificial ` +
        `(OpenAI) únicamente para generar el análisis. Rityvo no almacena la foto — solo ` +
        `guarda el resultado, que puedes eliminar cuando quieras desde tu perfil.`;
  }
}

export default function CameraDisclosureModal({
  visible,
  subject,
  destino = 'ia',
  title = 'Antes de analizar tu foto',
  onAccept,
  onCancel,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={s.overlay}>
        <View style={s.sheet} accessibilityViewIsModal>
          <Text style={{ fontSize: 40, marginBottom: 10 }} accessibilityElementsHidden importantForAccessibility="no">📸</Text>
          <Text style={s.title} accessibilityRole="header">{title}</Text>
          <Text style={s.body}>{textoDe(destino, subject)}</Text>
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={onAccept}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Entendido, continuar con el análisis"
          >
            <Text style={s.primaryBtnTxt}>Entendido, continuar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.secondaryBtn}
            onPress={onCancel}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Cancelar y no enviar ninguna foto"
          >
            <Text style={s.secondaryBtnTxt}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.bgCard, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: Spacing.xl },
  title: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.textPrimary, marginBottom: 8 },
  body: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.lg },
  primaryBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 16, alignItems: 'center' },
  primaryBtnTxt: { fontFamily: Fonts.heading, fontSize: 15, color: '#0a0a0b', letterSpacing: 0.6 },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  secondaryBtnTxt: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.textMuted },
});
