import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '../lib/auth';

SplashScreen.preventAutoHideAsync();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, loading, mustChangePassword } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inChangePassword = segments[0] === 'change-password';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup) {
      // After login, check if password change is required
      if (mustChangePassword) {
        router.replace('/change-password');
      } else {
        router.replace('/(tabs)');
      }
    } else if (session && mustChangePassword && !inChangePassword) {
      // Force redirect to change password if required
      router.replace('/change-password');
    }
  }, [session, loading, segments, mustChangePassword]);

  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'DMSans-Regular': require('../assets/fonts/DMSans-Regular.ttf'),
    'DMSans-Medium': require('../assets/fonts/DMSans-Medium.ttf'),
    'DMSans-SemiBold': require('../assets/fonts/DMSans-SemiBold.ttf'),
    'DMSans-Bold': require('../assets/fonts/DMSans-Bold.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <AuthProvider>
      <AuthGuard>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="change-password" options={{ gestureEnabled: false }} />
          <Stack.Screen name="voice-assistant" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        </Stack>
      </AuthGuard>
    </AuthProvider>
  );
}
