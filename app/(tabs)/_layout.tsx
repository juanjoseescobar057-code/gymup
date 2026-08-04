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
      <Text style={[styles.camLabel, activo && { color: Colors.accent }]}>ESCANEAR</Text>
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
        tabBarShowLabel: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🏠</Text>,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progreso',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📊</Text>,
        }}
      />
      <Tabs.Screen
        name="camera"
        options={{
          title: '',
          tabBarButton: CameraTabButton,
          tabBarIcon: () => <Text style={{ fontSize: 24 }}>📷</Text>,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: 'Coach',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🎥</Text>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>👤</Text>,
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
