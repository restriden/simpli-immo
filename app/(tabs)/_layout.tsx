import { Tabs } from 'expo-router';
import { View, StyleSheet, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: '#F97316',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarLabelStyle: {
          fontFamily: 'DMSans-Medium',
          fontSize: 10,
          marginTop: -4,
        },
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.95)' : '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: 'rgba(249, 115, 22, 0.1)',
          height: Platform.OS === 'ios' ? 88 : 70,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : 12,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.05,
          shadowRadius: 16,
          elevation: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'To-Do',
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.iconContainer}>
              <Feather name="check-circle" size={24} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="objekte"
        options={{
          title: 'Objekte',
          tabBarIcon: ({ color }) => (
            <Feather name="home" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="magic"
        options={{
          title: '',
          tabBarIcon: ({ focused }) => (
            <View style={styles.magicIconContainer}>
              <View style={styles.magicButtonInner}>
                <Feather name="zap" size={26} color="#FFFFFF" />
              </View>
            </View>
          ),
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen
        name="leads"
        options={{
          title: 'Leads',
          tabBarIcon: ({ color }) => (
            <Feather name="users" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profil"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color }) => (
            <Feather name="user" size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    position: 'relative',
  },
  magicIconContainer: {
    position: 'relative',
    marginTop: -24,
  },
  magicButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F97316',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
});
