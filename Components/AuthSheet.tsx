// Components/AuthSheet.tsx
// ─────────────────────────────────────────────────────────
// Hoja modal reutilizable para:
//   • mode="link"   → guardar progreso (vincular email a sesión anónima)
//   • mode="signin" → iniciar sesión en cuenta existente
//
// TRES COSAS QUE ESTABAN MAL Y SE PROBARON EN VIVO:
//
//   1. "¿Olvidaste tu contraseña?" usaba el correo escrito en el MISMO
//      formulario de entrar. Si estaba vacío, una alerta te regañaba; si lo
//      habías escrito, el enlace salía sin que quedara claro qué acababa de
//      pasar. Recuperar la contraseña no es un botón al pie de otro
//      formulario: es su propia tarea, y ahora tiene su propio paso.
//
//   2. Todo se contaba con Alert del sistema — el cuadro gris de Android. Un
//      error de validación no merece secuestrar la pantalla: ahora se enseña
//      donde ocurrió, debajo del campo.
//
//   3. Sin forma de ver la contraseña que escribes. En un teclado de móvil,
//      escribir ocho caracteres a ciegas y fallar es el motivo más tonto por el
//      que alguien abandona un registro.
//
// Lo que NO cambia, porque es de seguridad: el aviso al recuperar es el MISMO
// exista o no la cuenta. Decir "ese correo no está registrado" dejaría
// averiguar quién usa una app de salud probando direcciones.
// ─────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal,
  Keyboard, KeyboardAvoidingView, Platform, TouchableWithoutFeedback,
  ActivityIndicator, ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { linkEmailPassword, signInExisting, requestPasswordReset, isValidEmail, URL_CAMBIAR_CLAVE } from '../lib/account';
import { Colors, Fonts, Radii, Spacing, Type } from '../constants/theme';

type Props = {
  visible: boolean;
  mode: 'link' | 'signin';
  onClose: () => void;
  onSuccess: () => void;
};

/** Qué está enseñando la hoja ahora mismo. */
type Vista = 'formulario' | 'recuperar' | 'enviado';

export default function AuthSheet({ visible, mode, onClose, onSuccess }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>('formulario');

  const isLink = mode === 'link';

  // Al cerrar y volver a abrir se empieza limpio. Sin esto, quien cerró en el
  // paso de recuperar lo encontraba ahí otra vez sin saber por qué.
  useEffect(() => {
    if (!visible) {
      setVista('formulario');
      setError(null);
      setAviso(null);
      setVerClave(false);
      setBusy(false);
    }
  }, [visible]);

  function cerrar() {
    Keyboard.dismiss();
    onClose();
  }

  // ── Entrar o crear cuenta ──

  async function submit() {
    Keyboard.dismiss();
    setError(null);
    setAviso(null);

    // Validar AQUÍ y no en el servidor: un viaje de red para decir "el correo
    // no tiene arroba" es tiempo de espera por nada.
    if (!isValidEmail(email)) {
      setError('Ese correo no parece válido. Revísalo.');
      return;
    }
    if (password.length < 8) {
      setError('La contraseña necesita al menos 8 caracteres.');
      return;
    }

    setBusy(true);
    try {
      const res = isLink
        ? await linkEmailPassword(email, password)
        : await signInExisting(email, password);

      if (!res.ok) {
        setError(res.error ?? 'No pudimos completar la operación. Intenta de nuevo.');
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (isLink && 'needsEmailConfirm' in res && res.needsEmailConfirm) {
        // Ver lib/account.ts: hasta que se confirma, el correo no queda atado a
        // la cuenta y no sirve para iniciar sesión. Decirle que ya está a salvo
        // es justo la frase que consigue que no abra ese correo.
        setAviso(
          'Te enviamos un enlace para confirmar tu correo. Mientras no lo abras, tu cuenta ' +
          'vive solo en este teléfono: si lo pierdes o reinstalas la app no podrás entrar ' +
          'con ese correo.'
        );
        setPassword('');
        setBusy(false);
        return;
      }

      setEmail('');
      setPassword('');
      onSuccess();
    } finally {
      setBusy(false);
    }
  }

  // ── Recuperar contraseña ──

  async function enviarRecuperacion() {
    Keyboard.dismiss();
    setError(null);

    if (!isValidEmail(email)) {
      setError('Escribe el correo con el que te registraste.');
      return;
    }

    setBusy(true);
    try {
      const res = await requestPasswordReset(email, URL_CAMBIAR_CLAVE);
      if (!res.ok) {
        setError(res.error ?? 'No pudimos enviar el enlace. Intenta de nuevo.');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setVista('enviado');
    } finally {
      setBusy(false);
    }
  }

  // ── Textos según el paso ──

  const titulo =
    vista === 'recuperar' ? 'RECUPERAR CONTRASEÑA'
      : vista === 'enviado' ? 'REVISA TU CORREO'
        : isLink ? 'GUARDA TU PROGRESO' : 'INICIAR SESIÓN';

  const subtitulo =
    vista === 'recuperar'
      ? 'Te mandamos un enlace para crear una contraseña nueva.'
      : vista === 'enviado'
        ? null
        : isLink
          ? 'Crea una cuenta para no perder tu racha, historial y fotos si cambias de teléfono.'
          : 'Entra con tu cuenta para recuperar tus datos en este dispositivo.';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={cerrar}>
      <TouchableWithoutFeedback onPress={cerrar}>
        <View style={s.overlay}>
          <TouchableWithoutFeedback onPress={() => {}}>
            {/* En Android undefined: el sistema ya redimensiona la ventana y un
                segundo ajuste descoloca el contenido. Ver
                __tests__/tecladoNoTapaLosBotones.test.ts. */}
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'position' : undefined}>
              <View style={s.box} accessibilityViewIsModal>
                {/* Asa de arrastre. No hace nada, y hace mucho: es la señal de
                    que esto es una hoja que se puede cerrar, no una pantalla
                    en la que te has quedado atrapado. */}
                <View style={s.asa} />

                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: Spacing.sm }}
                >
                  <Text style={s.title} accessibilityRole="header">{titulo}</Text>
                  {!!subtitulo && <Text style={s.sub}>{subtitulo}</Text>}

                  {vista === 'enviado' ? (
                    <>
                      <View style={s.exito}>
                        <Text style={s.exitoTxt}>
                          Si hay una cuenta con <Text style={s.exitoFuerte}>{email.trim()}</Text>,
                          te acabamos de enviar un enlace para cambiar tu contraseña.
                        </Text>
                        <Text style={s.exitoNota}>
                          Mira también en spam: es un correo nuevo y a veces cae ahí la primera vez.
                        </Text>
                      </View>

                      <TouchableOpacity
                        style={s.btn}
                        onPress={() => { setVista('formulario'); setError(null); }}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Volver a iniciar sesión"
                      >
                        <Text style={s.btnTxt}>VOLVER A ENTRAR</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <Text style={s.lbl}>Correo</Text>
                      <TextInput
                        style={[s.input, !!error && vista === 'recuperar' && s.inputError]}
                        value={email}
                        onChangeText={(t) => { setEmail(t); setError(null); }}
                        placeholder="tu@correo.com"
                        placeholderTextColor={Colors.textDisabled}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        autoComplete="email"
                        editable={!busy}
                        accessibilityLabel="Correo electrónico"
                      />

                      {vista === 'formulario' && (
                        <>
                          <Text style={s.lbl}>Contraseña</Text>
                          <View style={s.claveFila}>
                            <TextInput
                              style={[s.input, s.inputClave]}
                              value={password}
                              onChangeText={(t) => { setPassword(t); setError(null); }}
                              placeholder={isLink ? 'Mínimo 8 caracteres' : 'Tu contraseña'}
                              placeholderTextColor={Colors.textDisabled}
                              secureTextEntry={!verClave}
                              autoCapitalize="none"
                              autoComplete={isLink ? 'new-password' : 'current-password'}
                              editable={!busy}
                              accessibilityLabel="Contraseña"
                            />
                            {/* Escribir ocho caracteres a ciegas en un teclado
                                de móvil y fallar es el motivo más tonto por el
                                que alguien abandona un registro. */}
                            <TouchableOpacity
                              onPress={() => setVerClave((v) => !v)}
                              style={s.ojo}
                              accessibilityRole="button"
                              accessibilityLabel={verClave ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
                            >
                              <Text style={s.ojoTxt}>{verClave ? 'Ocultar' : 'Ver'}</Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      )}

                      {/* El error va DONDE OCURRIÓ, no en un cuadro del sistema
                          que tapa la pantalla y hay que cerrar para volver a
                          ver el campo que hay que corregir. */}
                      {!!error && (
                        <View style={s.errorCaja} accessibilityLiveRegion="polite">
                          <Text style={s.errorTxt}>{error}</Text>
                        </View>
                      )}

                      {!!aviso && (
                        <View style={s.avisoCaja} accessibilityLiveRegion="polite">
                          <Text style={s.avisoTxt}>{aviso}</Text>
                        </View>
                      )}

                      <TouchableOpacity
                        style={[s.btn, busy && { opacity: 0.6 }]}
                        onPress={vista === 'recuperar' ? enviarRecuperacion : submit}
                        disabled={busy}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: busy, busy }}
                        accessibilityLabel={
                          busy ? 'Un momento, procesando'
                            : vista === 'recuperar' ? 'Enviarme el enlace'
                              : isLink ? 'Crear mi cuenta' : 'Entrar'
                        }
                      >
                        {busy ? (
                          <ActivityIndicator color="#0a0a0b" />
                        ) : (
                          <Text style={s.btnTxt}>
                            {vista === 'recuperar' ? 'ENVIARME EL ENLACE' : isLink ? 'CREAR CUENTA' : 'ENTRAR'}
                          </Text>
                        )}
                      </TouchableOpacity>

                      {/* Recuperar es su propia tarea, con su propio paso. Solo
                          al ENTRAR: al crear cuenta no hay contraseña que
                          recuperar todavía. */}
                      {!isLink && vista === 'formulario' && (
                        <TouchableOpacity
                          onPress={() => { setVista('recuperar'); setError(null); setAviso(null); }}
                          disabled={busy}
                          style={s.enlaceFila}
                          accessibilityRole="button"
                          accessibilityLabel="Olvidé mi contraseña"
                        >
                          <Text style={s.link}>¿Olvidaste tu contraseña?</Text>
                        </TouchableOpacity>
                      )}

                      {vista === 'recuperar' && (
                        <TouchableOpacity
                          onPress={() => { setVista('formulario'); setError(null); }}
                          disabled={busy}
                          style={s.enlaceFila}
                          accessibilityRole="button"
                          accessibilityLabel="Volver a iniciar sesión"
                        >
                          <Text style={s.link}>‹ Volver a entrar</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}

                  <TouchableOpacity
                    onPress={cerrar}
                    style={s.enlaceFila}
                    accessibilityRole="button"
                    accessibilityLabel="Cerrar"
                  >
                    <Text style={s.cancel}>Cerrar</Text>
                  </TouchableOpacity>
                </ScrollView>
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
  box: {
    backgroundColor: Colors.bgCard,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm, paddingBottom: Spacing.xl,
    borderTopWidth: 1, borderTopColor: Colors.border,
    maxHeight: '90%',
  },
  asa: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: Spacing.lg,
  },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.textPrimary, marginBottom: 6 },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: Spacing.sm },
  lbl: {
    fontFamily: Fonts.bodySemi, fontSize: Type.micro, color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginTop: Spacing.md,
  },
  input: {
    backgroundColor: Colors.bgInput, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radii.md, paddingHorizontal: Spacing.md, paddingVertical: 14,
    fontFamily: Fonts.bodyMedium, fontSize: 16, color: Colors.textPrimary,
  },
  inputError: { borderColor: Colors.error },
  claveFila: { position: 'relative', justifyContent: 'center' },
  inputClave: { paddingRight: 74 },
  ojo: {
    position: 'absolute', right: 4, top: 0, bottom: 0,
    paddingHorizontal: Spacing.md, justifyContent: 'center', minHeight: 44,
  },
  ojoTxt: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.accent },

  errorCaja: {
    backgroundColor: 'rgba(255,68,68,0.10)', borderRadius: Radii.md,
    paddingHorizontal: Spacing.md, paddingVertical: 12, marginTop: Spacing.md,
  },
  errorTxt: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.error, lineHeight: 19 },

  avisoCaja: {
    backgroundColor: Colors.accentMuted, borderRadius: Radii.md,
    paddingHorizontal: Spacing.md, paddingVertical: 12, marginTop: Spacing.md,
  },
  avisoTxt: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textPrimary, lineHeight: 19 },

  exito: {
    backgroundColor: Colors.accentMuted, borderRadius: Radii.md,
    padding: Spacing.md, marginTop: Spacing.sm,
  },
  exitoTxt: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textPrimary, lineHeight: 22 },
  exitoFuerte: { fontFamily: Fonts.bodySemi, color: Colors.accent },
  exitoNota: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginTop: Spacing.sm },

  btn: {
    backgroundColor: Colors.accent, borderRadius: Radii.lg,
    minHeight: 54, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.lg,
  },
  btnTxt: { fontFamily: Fonts.heading, fontSize: 17, color: '#0a0a0b', letterSpacing: 0.8 },
  enlaceFila: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  cancel: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textMuted },
  link: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.accent },
});
