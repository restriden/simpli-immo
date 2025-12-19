import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';

export default function ProfilScreen() {
  const router = useRouter();
  const { user, profile, signOut, loading: authLoading } = useAuth();


  // Edit Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editCompanyName, setEditCompanyName] = useState('');
  const [saving, setSaving] = useState(false);
  const [localCompanyName, setLocalCompanyName] = useState<string | null>(null);


  // Handle Edit Company Name
  const displayCompanyName = localCompanyName ?? profile?.company_name;

  const handleOpenEdit = () => {
    setEditCompanyName(displayCompanyName || '');
    setShowEditModal(true);
  };

  const handleSaveCompanyName = async () => {
    if (!user?.id || !editCompanyName.trim()) return;

    setSaving(true);
    try {
      const response = await fetch(
        'https://hsfrdovpgxtqbitmkrhs.supabase.co/functions/v1/update-business-name',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: user.id,
            business_name: editCompanyName.trim(),
          }),
        }
      );

      const result = await response.json();

      if (result.success) {
        // Update local state for immediate UI feedback
        setLocalCompanyName(editCompanyName.trim());
        Alert.alert('Erfolg', result.message);
        setShowEditModal(false);
      } else {
        Alert.alert('Fehler', result.error || 'Speichern fehlgeschlagen');
      }
    } catch (error) {
      console.error('Save error:', error);
      Alert.alert('Fehler', 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Abmelden', 'Möchtest du dich wirklich abmelden?', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Abmelden', style: 'destructive', onPress: async () => {
        await signOut();
        router.replace('/(auth)/login');
      }},
    ]);
  };

  const initials = profile?.full_name?.split(' ').map(n => n[0]).join('').toUpperCase() || 'MK';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Profil</Text>
        <TouchableOpacity style={styles.settingsButton}>
          <Feather name="settings" size={22} color="#6B7280" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{profile?.full_name || 'Max Köhler'}</Text>
            <Text style={styles.userEmail}>{profile?.email || 'max@example.com'}</Text>
          </View>
          <TouchableOpacity style={styles.editButton}>
            <Feather name="edit-2" size={18} color="#F97316" />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Unternehmen</Text>
          <TouchableOpacity style={styles.card} onPress={handleOpenEdit} activeOpacity={0.7}>
            <View style={styles.cardRow}>
              <View style={styles.cardIcon}><Feather name="briefcase" size={18} color="#F97316" /></View>
              <View style={styles.cardContent}>
                <Text style={styles.cardLabel}>Firma</Text>
                <Text style={styles.cardValue}>{displayCompanyName || 'Firma eingeben...'}</Text>
              </View>
              <Feather name="edit-2" size={16} color="#9CA3AF" />
            </View>
          </TouchableOpacity>
        </View>


        <View style={styles.section}>
          <Text style={styles.sectionTitle}>KI-Assistent</Text>
          <TouchableOpacity style={styles.kiCard}>
            <View style={styles.kiHeader}>
              <View style={styles.kiIconContainer}>
                <Feather name="cpu" size={24} color="#FFFFFF" />
              </View>
              <View style={styles.kiContent}>
                <Text style={styles.kiTitle}>KI-Wissensdatenbank</Text>
                <Text style={styles.kiSubtitle}>18 Fakten gespeichert</Text>
              </View>
              <Feather name="chevron-right" size={20} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Einstellungen</Text>
          <View style={styles.menuCard}>
            {[
              { icon: 'bell', label: 'Benachrichtigungen' },
              { icon: 'shield', label: 'Datenschutz' },
              { icon: 'help-circle', label: 'Hilfe & Support' },
              { icon: 'info', label: 'Über simpli.immo' },
            ].map((item, index) => (
              <React.Fragment key={item.label}>
                <TouchableOpacity style={styles.menuItem}>
                  <View style={styles.menuIcon}><Feather name={item.icon as any} size={18} color="#6B7280" /></View>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  <Feather name="chevron-right" size={18} color="#D1D5DB" />
                </TouchableOpacity>
                {index < 3 && <View style={styles.menuDivider} />}
              </React.Fragment>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Feather name="log-out" size={20} color="#EF4444" />
          <Text style={styles.signOutText}>Abmelden</Text>
        </TouchableOpacity>

        <Text style={styles.version}>Version 1.0.0</Text>
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Edit Company Name Modal */}
      <Modal visible={showEditModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowEditModal(false)}
          />
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Firmenname bearbeiten</Text>
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <Feather name="x" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.modalLabel}>Firmenname</Text>
              <TextInput
                style={styles.modalInput}
                value={editCompanyName}
                onChangeText={setEditCompanyName}
                placeholder="z.B. Immobilien Müller GmbH"
                placeholderTextColor="#9CA3AF"
                autoFocus
              />
              <Text style={styles.modalHint}>
                Der Name wird mit deinem CRM-Subaccount synchronisiert.
              </Text>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setShowEditModal(false)}
              >
                <Text style={styles.modalCancelText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSaveButton, saving && styles.modalSaveButtonDisabled]}
                onPress={handleSaveCompanyName}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSaveText}>Speichern</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 28, fontFamily: 'DMSans-Bold', color: '#111827' },
  settingsButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#F9FAFB', justifyContent: 'center', alignItems: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  userCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: '#F3F4F6' },
  avatar: { width: 60, height: 60, borderRadius: 16, backgroundColor: '#F97316', justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 22, fontFamily: 'DMSans-Bold', color: '#FFFFFF' },
  userInfo: { flex: 1, marginLeft: 14 },
  userName: { fontSize: 18, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  userEmail: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },
  editButton: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#6B7280', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 4, borderWidth: 1, borderColor: '#F3F4F6' },
  cardRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  cardIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  cardContent: { flex: 1, marginLeft: 12 },
  cardLabel: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#9CA3AF' },
  cardValue: { fontSize: 15, fontFamily: 'DMSans-Medium', color: '#111827', marginTop: 1 },
  kiCard: { backgroundColor: '#F97316', borderRadius: 16, padding: 16 },
  kiHeader: { flexDirection: 'row', alignItems: 'center' },
  kiIconContainer: { width: 48, height: 48, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  kiContent: { flex: 1, marginLeft: 12 },
  kiTitle: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#FFFFFF' },
  kiSubtitle: { fontSize: 13, fontFamily: 'DMSans-Regular', color: 'rgba(255,255,255,0.8)', marginTop: 1 },
  menuCard: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#F3F4F6' },
  menuItem: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  menuIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F9FAFB', justifyContent: 'center', alignItems: 'center' },
  menuLabel: { flex: 1, fontSize: 15, fontFamily: 'DMSans-Medium', color: '#111827', marginLeft: 12 },
  menuDivider: { height: 1, backgroundColor: '#F3F4F6', marginLeft: 64 },
  signOutButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, marginTop: 8 },
  signOutText: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#EF4444' },
  version: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#9CA3AF', textAlign: 'center', marginTop: 8 },

  // Modal Styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBackdrop: { flex: 1 },
  modalContent: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  modalTitle: { fontSize: 18, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  modalBody: { padding: 20 },
  modalLabel: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 8 },
  modalInput: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, fontFamily: 'DMSans-Regular', color: '#111827' },
  modalHint: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#9CA3AF', marginTop: 8 },
  modalFooter: { flexDirection: 'row', gap: 12, padding: 20, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  modalCancelButton: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center' },
  modalCancelText: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#6B7280' },
  modalSaveButton: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#F97316', alignItems: 'center' },
  modalSaveButtonDisabled: { opacity: 0.6 },
  modalSaveText: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#FFFFFF' },
});
