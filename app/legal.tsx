import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Radii, Spacing, Type } from '../constants/theme';

const PRIVACY = [
  ['Responsable', 'Juan José Escobar · Bogotá, Colombia · juanjoseescobar057@gmail.com'],
  ['Datos tratados', 'Perfil, edad, medidas corporales, objetivo, actividad, rendimiento, comidas, peso, lesiones, condiciones y respuestas de seguridad. Las fotos de comida, nevera, cuerpo o postura se procesan solo cuando eliges esas funciones.'],
  ['Finalidades', 'Crear y adaptar tu plan, registrar progreso, dar recomendaciones responsables, seguridad de la sesión, soporte, prevención de fraude y mejora del producto. Los datos de salud no se usan para publicidad ni se venden.'],
  ['Proveedores', 'Supabase aloja cuenta y datos; OpenAI procesa solicitudes de IA y fotos elegidas; RevenueCat y Apple/Google gestionan suscripciones; Sentry ayuda a detectar fallos; PostHog recibe eventos de producto filtrados. La grabación de uso está apagada por defecto y requiere tu activación.'],
  ['Fotos e IA', 'Rityvo no guarda las fotos usadas para escaneo corporal, comida, nevera o postura; guarda el resultado que confirmas. OpenAI puede conservar datos de API temporalmente, normalmente hasta 30 días para prevención de abuso, salvo que se habiliten controles de retención reducida o cero. Las fotos de transformación sí se guardan cuando tú decides subirlas.'],
  ['Transferencias y conservación', 'Algunos proveedores procesan datos fuera de Colombia bajo medidas contractuales y técnicas. Conservamos tus datos mientras exista tu cuenta o sean necesarios para el servicio y obligaciones legales. Las copias de seguridad pueden tardar hasta 30 días adicionales en purgarse.'],
  ['Tus derechos', 'Puedes conocer, actualizar, rectificar y eliminar tus datos, retirar autorizaciones y presentar consultas o reclamos. Desde Perfil puedes borrar análisis corporales o toda la cuenta. También puedes escribir al contacto indicado.'],
  ['Seguridad y decisiones', 'Aplicamos autenticación, cifrado en tránsito, controles de acceso por usuario y minimización. Ninguna medición o recomendación de IA es un diagnóstico ni debe usarse como única base de una decisión médica.'],
];

const TERMS = [
  ['Elegibilidad', 'Debes tener 18 años o más y capacidad legal. La app no está dirigida a menores.'],
  ['Naturaleza del servicio', 'Rityvo ofrece herramientas educativas de fitness y nutrición asistidas por IA. No presta atención médica, fisioterapia, nutrición clínica ni entrenamiento presencial, y no sustituye profesionales cualificados.'],
  ['Seguridad', 'Declara tu salud de forma veraz, respeta las advertencias y detén la actividad ante dolor agudo, dolor de pecho, falta de aire severa, mareo, desmayo u otros síntomas de alarma. Obtén autorización profesional cuando se solicite.'],
  ['Estimaciones', 'Calorías, macros, análisis corporal, postura, repeticiones y proyecciones tienen incertidumbre. Debes confirmar alimentos, porciones y datos antes de actuar; no garantizamos resultados físicos específicos ni fechas exactas.'],
  ['Cuenta y conducta', 'Eres responsable de proteger tu acceso y de no intentar manipular XP, límites, pagos, sistemas de IA ni datos de otras personas. Podemos limitar usos abusivos o inseguros.'],
  ['Suscripciones', 'Premium se cobra y renueva mediante Apple o Google según el precio y periodo mostrados por la tienda. Puedes cancelar en la tienda; restaurar compras no genera un cobro. Reembolsos se rigen por sus políticas y la ley aplicable.'],
  ['Propiedad y disponibilidad', 'La app, marca, diseño y contenidos propios están protegidos. El servicio puede cambiar o interrumpirse por mantenimiento o terceros; procuramos preservar el historial y comunicar cambios materiales.'],
  ['Ley y contacto', 'Se aplica la normativa imperativa que proteja al consumidor y sus datos, incluida la aplicable en Colombia. Contacto: juanjoseescobar057@gmail.com.'],
];

export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const privacy = doc !== 'terms';
  const sections = privacy ? PRIVACY : TERMS;
  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Volver">
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{privacy ? 'PRIVACIDAD' : 'TÉRMINOS'}</Text>
        <View style={{ width: 44 }} />
      </View>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.title}>{privacy ? 'Política de Privacidad' : 'Términos de Uso'}</Text>
        <Text style={s.version}>
          {privacy ? 'Rityvo · Privacidad 1.3 · 4 de agosto de 2026' : 'Rityvo · Términos 1.0 · 15 de julio de 2026'}
        </Text>
        <Text style={s.intro}>
          {privacy
            ? 'Esta política resume de forma clara cómo tratamos tus datos, incluidos los sensibles de salud.'
            : 'Usa Rityvo solo si entiendes estos límites y puedes entrenar de manera segura.'}
        </Text>
        {sections.map(([title, body]) => (
          <View key={title} style={s.section}>
            <Text style={s.sectionTitle}>{title}</Text>
            <Text style={s.body}>{body}</Text>
          </View>
        ))}
        <TouchableOpacity style={s.switchDoc} onPress={() => router.replace(`/legal?doc=${privacy ? 'terms' : 'privacy'}` as any)}
          accessibilityRole="button" accessibilityLabel={privacy ? 'Leer términos de uso' : 'Leer política de privacidad'}>
          <Text style={s.switchTxt}>{privacy ? 'LEER TÉRMINOS DE USO' : 'LEER POLÍTICA DE PRIVACIDAD'}</Text>
        </TouchableOpacity>
        <Text style={s.note}>Estos textos deben recibir revisión jurídica local antes de una publicación comercial definitiva.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  back: { width: 44, height: 44, borderRadius: Radii.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center' },
  backTxt: { fontFamily: Fonts.heading, fontSize: 30, color: Colors.textPrimary, lineHeight: 32 },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.textPrimary, letterSpacing: 1 },
  scroll: { padding: Spacing.lg, paddingBottom: 48 },
  title: { fontFamily: Fonts.heading, fontSize: 38, color: Colors.textPrimary },
  version: { fontFamily: Fonts.body, fontSize: Type.caption, color: Colors.textMuted, marginTop: 4 },
  intro: { fontFamily: Fonts.body, fontSize: Type.bodyLg, lineHeight: 24, color: Colors.textSecondary, marginVertical: Spacing.lg },
  section: { paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border },
  sectionTitle: { fontFamily: Fonts.headingSemi, fontSize: 20, color: Colors.textPrimary, marginBottom: 5 },
  body: { fontFamily: Fonts.body, fontSize: Type.body, lineHeight: 22, color: Colors.textSecondary },
  switchDoc: { minHeight: 52, marginTop: Spacing.lg, borderRadius: Radii.lg, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  switchTxt: { fontFamily: Fonts.heading, fontSize: Type.bodyLg, color: '#0a0a0b', letterSpacing: 0.7 },
  note: { fontFamily: Fonts.body, fontSize: Type.micro, lineHeight: 16, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.lg },
});
