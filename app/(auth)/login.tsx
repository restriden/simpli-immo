import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Fehler', 'Bitte fülle alle Felder aus.');
      return;
    }

    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);

    if (error) {
      Alert.alert('Anmeldung fehlgeschlagen', error.message);
    } else {
      router.replace('/(tabs)');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <View style={styles.logo}>
              <Feather name="home" size={32} color="#FFFFFF" />
            </View>
          </View>
          <Text style={styles.appName}>simpli.immo</Text>
          <Text style={styles.tagline}>Dein intelligenter Makler-Assistent</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.title}>Willkommen zurück</Text>
          <Text style={styles.subtitle}>
            Melde dich an, um deine Leads zu verwalten
          </Text>

          <View style={styles.inputContainer}>
            <Feather name="mail" size={20} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="E-Mail-Adresse"
              placeholderTextColor="#9CA3AF"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
          </View>

          <View style={styles.inputContainer}>
            <Feather name="lock" size={20} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Passwort"
              placeholderTextColor="#9CA3AF"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="password"
            />
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              style={styles.passwordToggle}
            >
              <Feather
                name={showPassword ? 'eye-off' : 'eye'}
                size={20}
                color="#9CA3AF"
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.forgotPassword}>
            <Text style={styles.forgotPasswordText}>Passwort vergessen?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.loginButton, loading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.loginButtonText}>Anmelden</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>oder</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.registerContainer}>
            <Text style={styles.registerText}>Noch kein Konto? </Text>
            <Link href="/(auth)/register" asChild>
              <TouchableOpacity>
                <Text style={styles.registerLink}>Jetzt registrieren</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Powered by <Text style={styles.footerBrand}>Simpli Finance</Text>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoContainer: {
    marginBottom: 16,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#F97316',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  appName: {
    fontSize: 28,
    fontFamily: 'DMSans-Bold',
    color: '#111827',
    marginBottom: 4,
  },
  tagline: {
    fontSize: 14,
    fontFamily: 'DMSans-Regular',
    color: '#6B7280',
  },
  form: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontFamily: 'DMSans-Bold',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'DMSans-Regular',
    color: '#6B7280',
    marginBottom: 32,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 16,
    paddingHorizontal: 16,
    height: 56,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'DMSans-Regular',
    color: '#111827',
  },
  passwordToggle: {
    padding: 4,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 24,
  },
  forgotPasswordText: {
    fontSize: 14,
    fontFamily: 'DMSans-Medium',
    color: '#F97316',
  },
  loginButton: {
    backgroundColor: '#F97316',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    fontSize: 16,
    fontFamily: 'DMSans-SemiBold',
    color: '#FFFFFF',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 32,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  dividerText: {
    paddingHorizontal: 16,
    fontSize: 14,
    fontFamily: 'DMSans-Regular',
    color: '#9CA3AF',
  },
  registerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  registerText: {
    fontSize: 15,
    fontFamily: 'DMSans-Regular',
    color: '#6B7280',
  },
  registerLink: {
    fontSize: 15,
    fontFamily: 'DMSans-SemiBold',
    color: '#F97316',
  },
  footer: {
    alignItems: 'center',
    marginTop: 40,
  },
  footerText: {
    fontSize: 13,
    fontFamily: 'DMSans-Regular',
    color: '#9CA3AF',
  },
  footerBrand: {
    fontFamily: 'DMSans-SemiBold',
    color: '#F97316',
  },
});
