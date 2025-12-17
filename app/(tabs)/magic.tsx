import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

export default function MagicScreen() {
  const router = useRouter();

  useEffect(() => {
    router.push('/voice-assistant');
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#F97316" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
