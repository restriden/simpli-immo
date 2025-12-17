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

export default function RegisterScreen() {
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();
  const router = useRouter();

  const handleRegister = async () => {
    if (!fullName || !companyName || !email || !password || !confirmPassword) {
      Alert.alert('Fehler', 'Bitte fülle alle Felder aus.');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Fehler', 'Die Passwörter stimmen nicht überein.');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Fehler', 'Das Passwort muss mindestens 6 Zeichen lang sein.');
      return;
    }

    setLoading(true);
    const { error } = await signUp(email, password, fullName, companyName);
    setLoading(false);

    if (error) {
      Alert.alert('Registrierung fehlgeschlagen', error.message);
    } else {
      Alert.alert(
        'Registrierung erfolgreich',
        'Bitte bestätige deine E-Mail-Adresse, um dich anzumelden.',
        [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }]
      );
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
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity style={styles.backButton}>
              <Feather name="arrow-left" size={24} color="#111827" />
            </TouchableOpacity>
          </Link>
          <View style={styles.logoSmall}>
            <Feather name="home" size={20} color="#FFFFFF" />
          </View>
        </View>

        <View style={styles.form}>
          <Text style={styles.title}>Konto erstellen</Text>
          <Text style={styles.subtitle}>
            Starte jetzt mit simpli.immo und verwalte deine Leads effizienter
          </Text>

          <View style={styles.inputContainer}>
            <Feather name="user" size={20} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Dein Name"
              placeholderTextColor="#9CA3AF"
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
              autoComplete="name"
            />
          </View>

          <View style={styles.inputContainer}>
            <Feather name="briefcase" size={20} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Unternehmen / Firma"
              placeholderTextColor="#9CA3AF"
              value={companyName}
              onChangeText={setCompanyName}
              autoCapitalize="words"
            />
          </View>

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
              placeholder="Passwort (min. 6 Zeichen)"
              placeholderTextColor="#9CA3AF"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
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

          <View style={styles.inputContainer}>
            <Feather name="lock" size={20} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Passwort bestätigen"
              placeholderTextColor="#9CA3AF"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
          </View>

          <Text style={styles.terms}>
            Mit der Registrierung akzeptierst du unsere{' '}
            <Text style={styles.termsLink}>Nutzungsbedingungen</Text> und{' '}
            <Text style={styles.termsLink}>Datenschutzerklärung</Text>.
          </Text>

          <TouchableOpacity
            style={[styles.registerButton, loading && styles.registerButtonDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.registerButtonText}>Konto erstellen</Text>
            )}
          </TouchableOpacity>

          <View style={styles.loginContainer}>
            <Text style={styles.loginText}>Bereits ein Konto? </Text>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity>
                <Text style={styles.loginLink}>Jetzt anmelden</Text>
              </TouchableOpacity>
            </Link>
          </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoSmall: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F97316',
    justifyContent: 'center',
    alignItems: 'center',
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
    lineHeight: 22,
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
  terms: {
    fontSize: 13,
    fontFamily: 'DMSans-Regular',
    color: '#6B7280',
    lineHeight: 20,
    marginBottom: 24,
  },
  termsLink: {
    color: '#F97316',
    fontFamily: 'DMSans-Medium',
  },
  registerButton: {
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
  registerButtonDisabled: {
    opacity: 0.7,
  },
  registerButtonText: {
    fontSize: 16,
    fontFamily: 'DMSans-SemiBold',
    color: '#FFFFFF',
  },
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  loginText: {
    fontSize: 15,
    fontFamily: 'DMSans-Regular',
    color: '#6B7280',
  },
  loginLink: {
    fontSize: 15,
    fontFamily: 'DMSans-SemiBold',
    color: '#F97316',
  },
});
