// app/(tabs)/_layout.tsx
// ─────────────────────────────────────────────────────────
// Layout del tab bar principal.
// El botón central de cámara está elevado y tiene sombra.
// ─────────────────────────────────────────────────────────

import { Tabs } from 'expo-router';
import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts, Type } from '../../constants/theme';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

function TabGlyph({ name, color, size = 22 }: { name: 'home' | 'progress' | 'camera' | 'coach' | 'profile'; color: string; size?: number }) {
  const common = { stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {name === 'home' && <><Path d="M3 11.2 12 3l9 8.2" {...common} /><Path d="M5.5 10v10h13V10M9.5 20v-6h5v6" {...common} /></>}
      {name === 'progress' && <><Rect x="4" y="13" width="3.5" height="7" rx="1" {...common} /><Rect x="10.25" y="8" width="3.5" height="12" rx="1" {...common} /><Rect x="16.5" y="4" width="3.5" height="16" rx="1" {...common} /></>}
      {name === 'camera' && <><Path d="M7 7.5 8.6 5h6.8L17 7.5h2A2 2 0 0 1 21 9.5v8A2 2 0 0 1 19 19H5a2 2 0 0 1-2-2v-7.5a2 2 0 0 1 2-2h2Z" {...common} /><Circle cx="12" cy="13" r="3.5" {...common} /></>}
      {name === 'coach' && <><Rect x="3" y="6" width="14" height="12" rx="3" {...common} /><Path d="m17 10 4-2v8l-4-2M7.5 11h5M7.5 14h3" {...common} /></>}
      {name === 'profile' && <><Circle cx="12" cy="8" r="3.5" {...common} /><Path d="M5 20c.8-4 3.1-6 7-6s6.2 2 7 6" {...common} /></>}
    </Svg>
  );
}

/**
 * Botón central de Escanear.
 *
 * ANTES parecía la pestaña activa PERMANENTE: era un cuadro relleno del mismo
 * verde de acento que marca la selección, así que en cualquier pantalla el ojo
 * leía "estás en Escanear". Ahora el relleno verde se reserva para cuando
 * ESTÁ seleccionado; el resto del tiempo es un contorno. Sigue elevado y con
 * sombra, que es lo que comunica "acción especial" sin robarle el significado
 * al color de selección.
 */
function CameraTabButton({ onPress, children, accessibilityState }: BottomTabBarButtonProps) {
  const activo = !!accessibilityState?.selected;
  return (
    <TouchableOpacity
      style={styles.camBtn}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="tab"
      accessibilityLabel="Escanear"
      accessibilityHint="Escanea comida, tu nevera o tu cuerpo"
      accessibilityState={accessibilityState}
    >
      <View style={[styles.camBtnInner, activo ? styles.camBtnActivo : styles.camBtnInactivo]}>
        {children}
      </View>
      {/* La pestaña central no tenía label: era el único destino sin nombre. */}
      {/* allowFontScaling={false} igual que el resto de etiquetas de la barra:
          es un Text propio, así que tabBarAllowFontScaling no lo alcanza. */}
      <Text style={[styles.camLabel, activo && { color: Colors.accent }]} allowFontScaling={false}>ESCANEAR</Text>
    </TouchableOpacity>
  );
}

export default function TabsLayout() {
  // La altura y el padding estaban FIJOS (80 / 16). En teléfonos con
  // navegación por gestos el inset inferior es mayor, así que la barra de
  // Android se montaba encima de las etiquetas. Ahora se suma el inset real.
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: [
          styles.tabBar,
          { height: 74 + insets.bottom, paddingBottom: 10 + insets.bottom },
        ],
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarLabelStyle: styles.tabLabel,
        // La barra tiene alto fijo por diseño de plataforma: con la fuente del
        // sistema al 200% la etiqueta se comía el icono y la pestaña quedaba
        // sin identificar. Se acota SOLO aquí; el contenido de las pantallas
        // escala sin tope, que es lo que pide la accesibilidad.
        tabBarLabelPosition: 'below-icon',
        tabBarAllowFontScaling: false,
        tabBarShowLabel: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color }) => <TabGlyph name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progreso',
          tabBarIcon: ({ color }) => <TabGlyph name="progress" color={color} />,
        }}
      />
      <Tabs.Screen
        name="camera"
        options={{
          title: '',
          tabBarButton: CameraTabButton,
          tabBarIcon: ({ color }) => <TabGlyph name="camera" color={color} size={25} />,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: 'Coach',
          tabBarIcon: ({ color }) => <TabGlyph name="coach" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color }) => <TabGlyph name="profile" color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#111113',
    borderTopColor: '#1e1e22',
    borderTopWidth: 1,
    // height y paddingBottom se calculan con el safe area en el componente.
    paddingTop: 8,
  },
  tabLabel: {
    fontFamily: Fonts.bodySemi,
    fontSize: Type.micro,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  camBtn: {
    // Menos elevación que antes (-16): ahora debajo va la etiqueta y hay que
    // dejarle sitio dentro de la altura de la barra.
    top: -10,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  camBtnInner: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 12,
  },
  // Relleno verde SOLO cuando está seleccionado: es el mismo lenguaje que usa
  // el resto de la barra para marcar la pestaña activa.
  camBtnActivo: {
    backgroundColor: Colors.accent,
    borderWidth: 0,
  },
  camBtnInactivo: {
    backgroundColor: Colors.bgCard,
    borderWidth: 2,
    borderColor: Colors.accent,
  },
  camLabel: {
    fontFamily: Fonts.bodySemi,
    fontSize: Type.micro,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
});
