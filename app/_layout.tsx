import { useEffect } from 'react';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator } from 'react-native';
import { initAnalytics, trackScreen, track } from '../lib/analytics';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import {
  useFonts,
  BarlowCondensed_400Regular,
  BarlowCondensed_600SemiBold,
  BarlowCondensed_700Bold,
  BarlowCondensed_800ExtraBold,
  BarlowCondensed_900Black,
} from '@expo-google-fonts/barlow-condensed';
import {
  DMSans_300Light,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
} from '@expo-google-fonts/dm-sans';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Colors } from '../constants/theme';
import { initMonitoring } from '../lib/monitoring';

initMonitoring();

SplashScreen.preventAutoHideAsync();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function RootLayout() {
  const pathname = usePathname();

  // Analítica conductual propia: identidad + sesiones + cola por lotes.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    initAnalytics().then((fn) => { cleanup = fn; }).catch(() => {});
    // ¿Qué notificaciones funcionan? Registrar cada push que ABRE la app.
    const pushSub = Notifications.addNotificationResponseReceivedListener((r) => {
      track('push_opened', {
        title: r.notification.request.content.title?.slice(0, 60) ?? null,
      });
    });
    return () => { cleanup?.(); pushSub.remove(); };
  }, []);

  // Capa de navegación: cada cambio de ruta es un evento screen_viewed.
  useEffect(() => {
    if (pathname) trackScreen(pathname);
  }, [pathname]);

  const [fontsLoaded, fontError] = useFonts({
    BarlowCondensed_400Regular,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold,
    BarlowCondensed_900Black,
    DMSans_300Light,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" backgroundColor={Colors.bg} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)/onboarding" options={{ animation: 'fade' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="body-scan" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="food-scan" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="fridge-scan" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="workout-session" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="exercises" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="paywall" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="live-coach" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="coach-chat" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="telemetry" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="health" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="history" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="workout-complete" options={{ animation: 'fade', gestureEnabled: false }} />
      </Stack>
    </GestureHandlerRootView>
  );
}