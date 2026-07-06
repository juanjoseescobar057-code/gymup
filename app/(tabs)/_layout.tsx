// app/(tabs)/_layout.tsx
// ─────────────────────────────────────────────────────────
// Layout del tab bar principal.
// El botón central de cámara está elevado y tiene sombra.
// ─────────────────────────────────────────────────────────

import { Tabs } from 'expo-router';
import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { Colors, Fonts } from '../../constants/theme';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';

// Botón especial para la cámara (elevado, verde)
function CameraTabButton({ onPress, children }: BottomTabBarButtonProps) {
  return (
    <TouchableOpacity
      style={styles.camBtn}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.camBtnInner}>{children}</View>
    </TouchableOpacity>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textMuted,
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
    height: 80,
    paddingBottom: 16,
    paddingTop: 8,
  },
  tabLabel: {
    fontFamily: Fonts.bodySemi,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  camBtn: {
    top: -16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  camBtnInner: {
    width: 58,
    height: 58,
    backgroundColor: Colors.accent,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
});
