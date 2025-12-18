import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

const objektTypes = [
  { key: 'wohnung', label: 'Wohnung', icon: 'home' },
  { key: 'haus', label: 'Haus', icon: 'home' },
  { key: 'grundstueck', label: 'Grundstück', icon: 'map' },
  { key: 'gewerbe', label: 'Gewerbe', icon: 'briefcase' },
];

export default function ObjektErstellenScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [type, setType] = useState('wohnung');
  const [price, setPrice] = useState('');
  const [rooms, setRooms] = useState('');
  const [area, setArea] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Fehler', 'Bitte gib einen Namen für das Objekt ein.');
      return;
    }

    if (!city.trim()) {
      Alert.alert('Fehler', 'Bitte gib eine Stadt ein.');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('objekte')
        .insert({
          user_id: user?.id,
          name: name.trim(),
          city: city.trim(),
          type: type,
          price: price ? parseFloat(price.replace(/[^\d]/g, '')) : 0,
          rooms: rooms || '0',
          area_sqm: area ? parseFloat(area.replace(/[^\d]/g, '')) : 0,
          status: 'aktiv',
          ai_ready: false,
        })
        .select()
        .single();

      if (error) throw error;

      Alert.alert(
        'Objekt erstellt',
        'Du kannst jetzt Exposés hochladen und KI-Wissen hinzufügen.',
        [
          {
            text: 'Zum Objekt',
            onPress: () => router.replace(`/objekt/${data.id}`),
          },
        ]
      );
    } catch (error: any) {
      console.error('Create error:', error);
      Alert.alert('Fehler', error.message || 'Objekt konnte nicht erstellt werden.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Feather name="x" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Neues Objekt</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Objektname *</Text>
            <TextInput
              style={styles.textInput}
              value={name}
              onChangeText={setName}
              placeholder="z.B. Schöne 3-Zimmer-Wohnung"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="sentences"
            />
          </View>

          {/* City */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Stadt *</Text>
            <TextInput
              style={styles.textInput}
              value={city}
              onChangeText={setCity}
              placeholder="z.B. München"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="words"
            />
          </View>

          {/* Type */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Objektart</Text>
            <View style={styles.typeGrid}>
              {objektTypes.map((t) => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.typeOption, type === t.key && styles.typeOptionActive]}
                  onPress={() => setType(t.key)}
                >
                  <Feather
                    name={t.icon as any}
                    size={20}
                    color={type === t.key ? '#F97316' : '#6B7280'}
                  />
                  <Text
                    style={[styles.typeLabel, type === t.key && styles.typeLabelActive]}
                  >
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Price */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Preis (optional)</Text>
            <TextInput
              style={styles.textInput}
              value={price}
              onChangeText={setPrice}
              placeholder="z.B. 450.000"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
            />
            <Text style={styles.inputHint}>in Euro</Text>
          </View>

          {/* Row: Rooms & Area */}
          <View style={styles.rowInputs}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.inputLabel}>Zimmer</Text>
              <TextInput
                style={styles.textInput}
                value={rooms}
                onChangeText={setRooms}
                placeholder="z.B. 3"
                placeholderTextColor="#9CA3AF"
                keyboardType="numeric"
              />
            </View>
            <View style={{ width: 16 }} />
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.inputLabel}>Fläche</Text>
              <TextInput
                style={styles.textInput}
                value={area}
                onChangeText={setArea}
                placeholder="z.B. 85"
                placeholderTextColor="#9CA3AF"
                keyboardType="numeric"
              />
              <Text style={styles.inputHint}>in m²</Text>
            </View>
          </View>

          {/* Info */}
          <View style={styles.infoBox}>
            <Feather name="info" size={18} color="#3B82F6" />
            <Text style={styles.infoText}>
              Nach dem Erstellen kannst du ein Exposé hochladen und KI-Wissen hinzufügen.
            </Text>
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.createButton, saving && styles.createButtonDisabled]}
            onPress={handleCreate}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Feather name="plus" size={20} color="#FFFFFF" />
                <Text style={styles.createButtonText}>Objekt erstellen</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  keyboardView: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'DMSans-SemiBold',
    color: '#111827',
  },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20 },
  inputGroup: { marginBottom: 20 },
  inputLabel: {
    fontSize: 14,
    fontFamily: 'DMSans-SemiBold',
    color: '#111827',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: 'DMSans-Regular',
    color: '#111827',
  },
  inputHint: {
    fontSize: 12,
    fontFamily: 'DMSans-Regular',
    color: '#9CA3AF',
    marginTop: 4,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  typeOptionActive: {
    backgroundColor: '#FFF7ED',
    borderColor: '#F97316',
  },
  typeLabel: {
    fontSize: 14,
    fontFamily: 'DMSans-Medium',
    color: '#6B7280',
  },
  typeLabelActive: {
    color: '#F97316',
  },
  rowInputs: {
    flexDirection: 'row',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 16,
    marginTop: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'DMSans-Regular',
    color: '#1E40AF',
    lineHeight: 20,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingVertical: 16,
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    fontSize: 16,
    fontFamily: 'DMSans-SemiBold',
    color: '#FFFFFF',
  },
});
