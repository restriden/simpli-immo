import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';
import { getObjekt, getKiWissen, createKiWissen, deleteKiWissen, Objekt, KiWissen } from '../../lib/database';

const kategorien = [
  { key: 'objekt', label: 'Objekt', icon: 'home', color: '#3B82F6' },
  { key: 'umgebung', label: 'Umgebung', icon: 'map', color: '#22C55E' },
  { key: 'kosten', label: 'Kosten', icon: 'credit-card', color: '#F97316' },
  { key: 'rechtliches', label: 'Rechtliches', icon: 'file-text', color: '#8B5CF6' },
  { key: 'sonstiges', label: 'Sonstiges', icon: 'info', color: '#6B7280' },
];

export default function KiWissenScreen() {
  const router = useRouter();
  const { objektId } = useLocalSearchParams<{ objektId: string }>();
  const { user } = useAuth();

  const [objekt, setObjekt] = useState<Objekt | null>(null);
  const [wissen, setWissen] = useState<KiWissen[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKategorie, setSelectedKategorie] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [newFrage, setNewFrage] = useState('');
  const [newAntwort, setNewAntwort] = useState('');
  const [newKategorie, setNewKategorie] = useState('objekt');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, [objektId]);

  const loadData = async () => {
    if (!objektId) return;

    try {
      const [objektData, wissenData] = await Promise.all([
        getObjekt(objektId),
        getKiWissen(objektId),
      ]);

      setObjekt(objektData);
      setWissen(wissenData);
    } catch (error) {
      console.error('Error loading ki-wissen:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddWissen = async () => {
    if (!newFrage.trim() || !newAntwort.trim() || !user?.id || !objektId) return;

    setSaving(true);
    try {
      const newWissen = await createKiWissen({
        user_id: user.id,
        objekt_id: objektId,
        kategorie: newKategorie,
        frage: newFrage.trim(),
        antwort: newAntwort.trim(),
        quelle: 'manuell',
        is_auto_learned: false,
      });

      if (newWissen) {
        setWissen(prev => [...prev, newWissen]);
        setModalVisible(false);
        setNewFrage('');
        setNewAntwort('');
      }
    } catch (error) {
      console.error('Error creating ki-wissen:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteWissen = async (wissenId: string) => {
    try {
      const success = await deleteKiWissen(wissenId);
      if (success) {
        setWissen(prev => prev.filter(w => w.id !== wissenId));
      }
    } catch (error) {
      console.error('Error deleting ki-wissen:', error);
    }
  };

  const filteredWissen = selectedKategorie
    ? wissen.filter(w => w.kategorie === selectedKategorie)
    : wissen;

  const getKategorieInfo = (key: string) => {
    return kategorien.find(k => k.key === key) || kategorien[4];
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F97316" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#111827" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>KI-Wissen</Text>
          {objekt && <Text style={styles.headerSubtitle}>{objekt.name}</Text>}
        </View>
        <TouchableOpacity style={styles.addButton} onPress={() => setModalVisible(true)}>
          <Feather name="plus" size={24} color="#F97316" />
        </TouchableOpacity>
      </View>

      {/* Info Banner */}
      <View style={styles.infoBanner}>
        <Feather name="cpu" size={20} color="#F97316" />
        <Text style={styles.infoText}>
          Die KI nutzt dieses Wissen um Fragen von Interessenten automatisch zu beantworten.
        </Text>
      </View>

      {/* Kategorie Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.kategorieScroll}
        contentContainerStyle={styles.kategorieScrollContent}
      >
        <TouchableOpacity
          style={[styles.kategorieChip, !selectedKategorie && styles.kategorieChipActive]}
          onPress={() => setSelectedKategorie(null)}
        >
          <Text style={[styles.kategorieChipText, !selectedKategorie && styles.kategorieChipTextActive]}>
            Alle ({wissen.length})
          </Text>
        </TouchableOpacity>
        {kategorien.map((kat) => {
          const count = wissen.filter(w => w.kategorie === kat.key).length;
          return (
            <TouchableOpacity
              key={kat.key}
              style={[styles.kategorieChip, selectedKategorie === kat.key && styles.kategorieChipActive]}
              onPress={() => setSelectedKategorie(selectedKategorie === kat.key ? null : kat.key)}
            >
              <Feather name={kat.icon as any} size={14} color={selectedKategorie === kat.key ? '#F97316' : '#6B7280'} />
              <Text style={[styles.kategorieChipText, selectedKategorie === kat.key && styles.kategorieChipTextActive]}>
                {kat.label} ({count})
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {filteredWissen.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Feather name="book-open" size={48} color="#D1D5DB" />
            </View>
            <Text style={styles.emptyTitle}>Noch kein Wissen</Text>
            <Text style={styles.emptyText}>
              Füge Fragen und Antworten hinzu, damit die KI Interessenten besser informieren kann.
            </Text>
            <TouchableOpacity style={styles.emptyButton} onPress={() => setModalVisible(true)}>
              <Feather name="plus" size={18} color="#FFFFFF" />
              <Text style={styles.emptyButtonText}>Wissen hinzufügen</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filteredWissen.map((item) => {
            const kat = getKategorieInfo(item.kategorie);
            return (
              <View key={item.id} style={styles.wissenCard}>
                <View style={styles.wissenHeader}>
                  <View style={[styles.kategorieIcon, { backgroundColor: `${kat.color}15` }]}>
                    <Feather name={kat.icon as any} size={16} color={kat.color} />
                  </View>
                  <Text style={styles.kategorieLabel}>{kat.label}</Text>
                  {item.is_auto_learned && (
                    <View style={styles.autoLearnedBadge}>
                      <Feather name="zap" size={10} color="#F97316" />
                      <Text style={styles.autoLearnedText}>Auto</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleDeleteWissen(item.id)}
                  >
                    <Feather name="trash-2" size={16} color="#EF4444" />
                  </TouchableOpacity>
                </View>

                <Text style={styles.wissenFrage}>{item.frage}</Text>
                <Text style={styles.wissenAntwort}>{item.antwort}</Text>

                {item.kontakt_name && (
                  <Text style={styles.wissenQuelle}>
                    <Feather name="user" size={12} color="#9CA3AF" /> Gelernt von {item.kontakt_name}
                  </Text>
                )}
              </View>
            );
          })
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Add Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalVisible(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Text style={styles.modalCancel}>Abbrechen</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Neues Wissen</Text>
            <TouchableOpacity onPress={handleAddWissen} disabled={saving || !newFrage.trim() || !newAntwort.trim()}>
              <Text style={[styles.modalSave, (!newFrage.trim() || !newAntwort.trim()) && styles.modalSaveDisabled]}>
                {saving ? 'Speichern...' : 'Speichern'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            <Text style={styles.inputLabel}>Kategorie</Text>
            <View style={styles.kategorieSelect}>
              {kategorien.map((kat) => (
                <TouchableOpacity
                  key={kat.key}
                  style={[styles.kategorieOption, newKategorie === kat.key && styles.kategorieOptionActive]}
                  onPress={() => setNewKategorie(kat.key)}
                >
                  <Feather name={kat.icon as any} size={18} color={newKategorie === kat.key ? '#F97316' : '#6B7280'} />
                  <Text style={[styles.kategorieOptionText, newKategorie === kat.key && styles.kategorieOptionTextActive]}>
                    {kat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.inputLabel}>Frage</Text>
            <TextInput
              style={styles.textInput}
              placeholder="z.B. Wie hoch sind die Nebenkosten?"
              placeholderTextColor="#9CA3AF"
              value={newFrage}
              onChangeText={setNewFrage}
              multiline
            />

            <Text style={styles.inputLabel}>Antwort</Text>
            <TextInput
              style={[styles.textInput, styles.textInputLarge]}
              placeholder="Die detaillierte Antwort auf die Frage..."
              placeholderTextColor="#9CA3AF"
              value={newAntwort}
              onChangeText={setNewAntwort}
              multiline
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  backButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  headerContent: { flex: 1, marginLeft: 12 },
  headerTitle: { fontSize: 18, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  headerSubtitle: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 1 },
  addButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  infoBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF7ED', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#FFEDD5' },
  infoText: { flex: 1, fontSize: 13, fontFamily: 'DMSans-Regular', color: '#92400E' },
  kategorieScroll: { backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  kategorieScrollContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  kategorieChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  kategorieChipActive: { backgroundColor: '#FFF7ED' },
  kategorieChipText: { fontSize: 13, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  kategorieChipTextActive: { color: '#F97316' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16 },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { width: 80, height: 80, borderRadius: 20, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 4 },
  emptyText: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#6B7280', textAlign: 'center', marginBottom: 20, paddingHorizontal: 32 },
  emptyButton: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F97316', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  emptyButtonText: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#FFFFFF' },
  wissenCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#F3F4F6' },
  wissenHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  kategorieIcon: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  kategorieLabel: { fontSize: 13, fontFamily: 'DMSans-Medium', color: '#6B7280', marginLeft: 8, flex: 1 },
  autoLearnedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFF7ED', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  autoLearnedText: { fontSize: 11, fontFamily: 'DMSans-Medium', color: '#F97316' },
  deleteButton: { marginLeft: 8, padding: 4 },
  wissenFrage: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 8 },
  wissenAntwort: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#4B5563', lineHeight: 20 },
  wissenQuelle: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#9CA3AF', marginTop: 12 },
  modalContainer: { flex: 1, backgroundColor: '#FFFFFF' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  modalCancel: { fontSize: 16, fontFamily: 'DMSans-Regular', color: '#6B7280' },
  modalTitle: { fontSize: 17, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  modalSave: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#F97316' },
  modalSaveDisabled: { color: '#D1D5DB' },
  modalContent: { flex: 1, padding: 16 },
  inputLabel: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 8, marginTop: 16 },
  kategorieSelect: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kategorieOption: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#F3F4F6' },
  kategorieOptionActive: { backgroundColor: '#FFF7ED' },
  kategorieOptionText: { fontSize: 14, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  kategorieOptionTextActive: { color: '#F97316' },
  textInput: { backgroundColor: '#F3F4F6', borderRadius: 12, padding: 14, fontSize: 15, fontFamily: 'DMSans-Regular', color: '#111827', minHeight: 48 },
  textInputLarge: { minHeight: 120, textAlignVertical: 'top' },
});
