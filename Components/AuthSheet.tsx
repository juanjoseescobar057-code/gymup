// Components/AuthSheet.tsx
// ─────────────────────────────────────────────────────────
// Hoja modal reutilizable para:
//   • mode="link"   → guardar progreso (vincular email a sesión anónima)
//   • mode="signin" → iniciar sesión en cuenta existente
// ─────────────────────────────────────────────────────────

import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal,
  Keyboard, KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { linkEmailPassword, signInExisting, requestPasswordReset } from '../lib/account';
import { Colors, Fonts, Radii, Spacing, Type } from '../constants/theme';

type Props = {
  visible: boolean;
  mode: 'link' | 'signin';
  onClose: () => void;
  onSuccess: () => void;
};

export default function AuthSheet({ visible, mode, onClose, onSuccess }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * Recuperar contraseña. Antes no existía: quien la olvidaba perdía la cuenta
   * entera —entrenamientos, plan, racha y fotos— sin ninguna vía de vuelta.
   * El aviso es el MISMO exista o no la cuenta: decir "ese correo no está
   * registrado" dejaría averiguar quién usa una app de salud probando
   * direcciones.
   */
  async function recuperar() {
    Keyboard.dismiss();
    if (!email.trim()) {
      Alert.alert('Escribe tu correo', 'Necesitamos saber a qué dirección enviarte el enlace.');
      return;
    }
    setBusy(true);
    try {
      const res = await requestPasswordReset(email);
      if (!res.ok) {
        Alert.alert('No se pudo enviar', res.error ?? 'Intenta de nuevo.');
        return;
      }
      Alert.alert(
        'Revisa tu correo',
        'Si hay una cuenta con esa dirección, te enviamos un enlace para cambiar tu contraseña. Mira también la carpeta de spam.'
      );
    } finally {
      setBusy(false);
    }
  }

  const isLink = mode === 'link';
  const title = isLink ? 'GUARDA TU PROGRESO' : 'INICIAR SESIÓN';
  const subtitle = isLink
    ? 'Crea una cuenta para no perder tu racha, historial y fotos si cambias de teléfono.'
    : 'Entra con tu cuenta para recuperar tus datos en este dispositivo.';
  const cta = isLink ? 'CREAR CUENTA' : 'ENTRAR';

  async function submit() {
    Keyboard.dismiss();
    setBusy(true);
    try {
      const res = isLink
        ? await linkEmailPassword(email, password)
        : await signInExisting(email, password);

      if (!res.ok) {
        Alert.alert('No se pudo', res.error ?? 'Intenta de nuevo.');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (isLink && 'needsEmailConfirm' in res && res.needsEmailConfirm) {
        Alert.alert('Revisa tu correo', 'Te enviamos un email para confirmar tu cuenta. Tu progreso ya está vinculado.');
      }
      setEmail(''); setPassword('');
      onSuccess();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); onClose(); }}>
        <View style={s.overlay}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'position' : 'height'}>
              <View style={s.box} accessibilityViewIsModal>
                <Text style={s.title} accessibilityRole="header">{title}</Text>
                <Text style={s.sub}>{subtitle}</Text>

                <Text style={s.lbl}>Email</Text>
                <TextInput
                  style={s.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="tu@email.com"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  accessibilityLabel="Correo electrónico"
                />

                <Text style={s.lbl}>Contraseña</Text>
                <TextInput
                  style={s.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Mínimo 8 caracteres"
                  placeholderTextColor={Colors.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  accessibilityLabel="Contraseña"
                />

                <TouchableOpacity
                  style={[s.btn, busy && { opacity: 0.6 }]}
                  onPress={submit}
                  disabled={busy}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={busy ? 'Un momento, procesando' : cta}
                  accessibilityState={{ disabled: busy, busy }}
                >
                  <Text style={s.btnTxt}>{busy ? 'Un momento…' : cta}</Text>
                </TouchableOpacity>

                {/* Solo al iniciar sesión: al CREAR cuenta no hay contraseña
                    que recuperar todavía. */}
                {!isLink && (
                  <TouchableOpacity onPress={recuperar} disabled={busy}
                    style={{ paddingVertical: 12, alignItems: 'center' }}
                    accessibilityRole="button"
                    accessibilityLabel="Olvidé mi contraseña, enviarme un enlace para cambiarla">
                    <Text style={s.link}>¿Olvidaste tu contraseña?</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity onPress={() => { Keyboard.dismiss(); onClose(); }} style={{ paddingVertical: 12, alignItems: 'center' }}
                  accessibilityRole="button" accessibilityLabel="Cancelar y cerrar">
                  <Text style={s.cancel}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  box: { backgroundColor: Colors.bgCard, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: Spacing.xl, borderTopWidth: 1, borderTopColor: Colors.border },
  title: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.textPrimary, marginBottom: 6 },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: Spacing.lg },
  lbl: { fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginTop: Spacing.md },
  input: { backgroundColor: Colors.bgInput, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.md, paddingHorizontal: Spacing.md, paddingVertical: 14, fontFamily: Fonts.bodyMedium, fontSize: 16, color: Colors.textPrimary },
  btn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: 16, alignItems: 'center', marginTop: Spacing.lg },
  btnTxt: { fontFamily: Fonts.heading, fontSize: 18, color: '#0a0a0b', letterSpacing: 0.8 },
  cancel: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textMuted },
  link: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.accent },
});
