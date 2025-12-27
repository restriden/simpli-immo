import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { clearMustChangePassword } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleChangePassword = async () => {
    if (!newPassword || !confirmPassword) {
      Alert.alert('Fehler', 'Bitte beide Felder ausfüllen');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Fehler', 'Passwörter stimmen nicht überein');
      return;
    }

    if (newPassword.length < 8) {
      Alert.alert('Fehler', 'Passwort muss mindestens 8 Zeichen haben');
      return;
    }

    if (newPassword === 'simpli123') {
      Alert.alert('Fehler', 'Bitte wählen Sie ein anderes Passwort');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
        data: { must_change_password: false }
      });

      if (error) {
        Alert.alert('Fehler', error.message);
        return;
      }

      clearMustChangePassword();
      Alert.alert('Erfolg', 'Passwort wurde erfolgreich geändert', [
        { text: 'OK', onPress: () => router.replace('/(tabs)') }
      ]);
    } catch (error: any) {
      Alert.alert('Fehler', error.message || 'Ein Fehler ist aufgetreten');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Feather name="lock" size={48} color="#8B5CF6" />
          </View>

          <Text style={styles.title}>Passwort ändern</Text>
          <Text style={styles.subtitle}>
            Bitte ändern Sie Ihr temporäres Passwort, um fortzufahren.
          </Text>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Feather name="lock" size={20} color="#9CA3AF" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Neues Passwort"
                placeholderTextColor="#9CA3AF"
                secureTextEntry={!showPassword}
                value={newPassword}
                onChangeText={setNewPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={20} color="#9CA3AF" />
              </TouchableOpacity>
            </View>

            <View style={styles.inputContainer}>
              <Feather name="lock" size={20} color="#9CA3AF" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Passwort bestätigen"
                placeholderTextColor="#9CA3AF"
                secureTextEntry={!showConfirmPassword}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                <Feather name={showConfirmPassword ? 'eye-off' : 'eye'} size={20} color="#9CA3AF" />
              </TouchableOpacity>
            </View>

            <View style={styles.requirements}>
              <Text style={styles.requirementTitle}>Anforderungen:</Text>
              <Text style={[styles.requirement, newPassword.length >= 8 && styles.requirementMet]}>
                <Feather name={newPassword.length >= 8 ? 'check' : 'x'} size={14} /> Mindestens 8 Zeichen
              </Text>
              <Text style={[styles.requirement, newPassword === confirmPassword && newPassword.length > 0 && styles.requirementMet]}>
                <Feather name={newPassword === confirmPassword && newPassword.length > 0 ? 'check' : 'x'} size={14} /> Passwörter stimmen überein
              </Text>
              <Text style={[styles.requirement, newPassword !== 'simpli123' && newPassword.length > 0 && styles.requirementMet]}>
                <Feather name={newPassword !== 'simpli123' && newPassword.length > 0 ? 'check' : 'x'} size={14} /> Nicht das Standard-Passwort
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleChangePassword}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Wird geändert...' : 'Passwort ändern'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#EDE9FE',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontFamily: 'DMSans-Bold',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: 'DMSans-Regular',
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  form: {
    gap: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    height: 52,
    fontSize: 16,
    fontFamily: 'DMSans-Regular',
    color: '#111827',
  },
  requirements: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  requirementTitle: {
    fontSize: 14,
    fontFamily: 'DMSans-SemiBold',
    color: '#374151',
    marginBottom: 8,
  },
  requirement: {
    fontSize: 14,
    fontFamily: 'DMSans-Regular',
    color: '#9CA3AF',
    marginBottom: 4,
  },
  requirementMet: {
    color: '#10B981',
  },
  button: {
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'DMSans-SemiBold',
  },
});
