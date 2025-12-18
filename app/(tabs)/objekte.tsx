import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';
import { getObjekte, mergeObjekte, Objekt } from '../../lib/database';

export default function ObjekteScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<'alle' | 'aktiv' | 'verkauft'>('alle');
  const [objekte, setObjekte] = useState<Objekt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Merge state
  const [mergeModalVisible, setMergeModalVisible] = useState(false);
  const [sourceObjekt, setSourceObjekt] = useState<Objekt | null>(null);
  const [targetObjekt, setTargetObjekt] = useState<Objekt | null>(null);
  const [merging, setMerging] = useState(false);
  const [selectingFor, setSelectingFor] = useState<'source' | 'target' | null>(null);

  const loadObjekte = async () => {
    console.log('[DEBUG] loadObjekte called - user?.id:', user?.id);

    if (!user?.id) {
      console.log('[DEBUG] loadObjekte: No user.id, returning early');
      setLoading(false);  // FIX: Set loading to false even when no user
      return;
    }

    try {
      const data = await getObjekte(user.id);
      console.log('[DEBUG] loadObjekte: Received data:', data);
      setObjekte(data);
    } catch (error) {
      console.error('Error loading objekte:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadObjekte();
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadObjekte();
    }, [user?.id])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadObjekte();
    setRefreshing(false);
  };

  const handleMerge = async () => {
    if (!sourceObjekt || !targetObjekt || !user?.id) return;

    Alert.alert(
      'Objekte zusammenlegen?',
      `"${sourceObjekt.name}" wird in "${targetObjekt.name}" überführt.\n\nAlle Leads, KI-Wissen und Tasks werden übertragen. Das Quell-Objekt wird gelöscht.\n\nDieser Vorgang kann nicht rückgängig gemacht werden.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Zusammenlegen',
          style: 'destructive',
          onPress: async () => {
            setMerging(true);
            const result = await mergeObjekte(sourceObjekt.id, targetObjekt.id, user.id);
            setMerging(false);

            if (result.success) {
              Alert.alert(
                'Erfolgreich zusammengelegt',
                `${result.stats?.leads_moved || 0} Leads, ${result.stats?.ki_wissen_moved || 0} Wissenseinträge und ${result.stats?.todos_moved || 0} Tasks wurden übertragen.`
              );
              setMergeModalVisible(false);
              setSourceObjekt(null);
              setTargetObjekt(null);
              loadObjekte();
            } else {
              Alert.alert('Fehler', result.error || 'Zusammenlegen fehlgeschlagen');
            }
          },
        },
      ]
    );
  };

  const openMergeModal = () => {
    setSourceObjekt(null);
    setTargetObjekt(null);
    setSelectingFor(null);
    setMergeModalVisible(true);
  };

  const filteredObjekte = objekte.filter(obj => {
    if (filter === 'alle') return true;
    return obj.status === filter;
  });

  const getObjektCounts = (status: string) => {
    if (status === 'alle') return objekte.length;
    return objekte.filter(o => o.status === status).length;
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
      <View style={styles.header}>
        <Text style={styles.title}>Objekte</Text>
        <View style={styles.headerButtons}>
          {objekte.length >= 2 && (
            <TouchableOpacity
              style={styles.mergeButton}
              onPress={openMergeModal}
            >
              <Feather name="git-merge" size={20} color="#6B7280" />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => router.push('/objekt-erstellen')}
          >
            <Feather name="plus" size={24} color="#F97316" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.filterContainer}>
          {['alle', 'aktiv', 'verkauft'].map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterTab, filter === f && styles.filterTabActive]}
              onPress={() => setFilter(f as any)}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                {f.charAt(0).toUpperCase() + f.slice(1)} ({getObjektCounts(f)})
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {filteredObjekte.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Feather name="home" size={48} color="#D1D5DB" />
            </View>
            <Text style={styles.emptyTitle}>Noch keine Objekte</Text>
            <Text style={styles.emptyText}>
              Erstelle ein neues Objekt und füge Infos hinzu.
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => router.push('/objekt-erstellen')}
            >
              <Feather name="plus" size={18} color="#FFFFFF" />
              <Text style={styles.emptyButtonText}>Objekt erstellen</Text>
            </TouchableOpacity>
          </View>
        )}

        {filteredObjekte.map(objekt => (
          <TouchableOpacity 
            key={objekt.id} 
            style={styles.objektCard}
            onPress={() => router.push(`/objekt/${objekt.id}`)}
          >
            <View style={styles.objektImage}>
              <Feather name="home" size={32} color="#D1D5DB" />
              {objekt.status === 'verkauft' && (
                <View style={styles.soldOverlay}>
                  <Text style={styles.soldOverlayText}>VERKAUFT</Text>
                </View>
              )}
            </View>
            
            <View style={styles.objektContent}>
              <View style={styles.objektHeader}>
                <Text style={styles.objektName} numberOfLines={1}>{objekt.name}</Text>
                {objekt.ai_ready && objekt.status !== 'verkauft' && (
                  <View style={styles.aiBadge}>
                    <Feather name="cpu" size={12} color="#F97316" />
                  </View>
                )}
              </View>
              
              <Text style={styles.objektCity}>
                <Feather name="map-pin" size={12} color="#9CA3AF" /> {objekt.city}
              </Text>
              
              <View style={styles.objektDetails}>
                <Text style={styles.objektRooms}>{objekt.rooms} Zimmer · {objekt.area_sqm}m²</Text>
              </View>
              
              <View style={styles.objektFooter}>
                <Text style={styles.objektPrice}>
                  €{objekt.price?.toLocaleString('de-DE')}
                </Text>
              </View>
            </View>
            
            <Feather name="chevron-right" size={20} color="#D1D5DB" />
          </TouchableOpacity>
        ))}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Merge Modal */}
      <Modal
        visible={mergeModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setMergeModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Objekte zusammenlegen</Text>
              <TouchableOpacity onPress={() => setMergeModalVisible(false)}>
                <Feather name="x" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              Wähle das Quell-Objekt (wird gelöscht) und das Ziel-Objekt (bleibt bestehen).
            </Text>

            {/* Source Selection */}
            <Text style={styles.selectorLabel}>Quell-Objekt (wird gelöscht):</Text>
            {selectingFor === 'source' ? (
              <ScrollView style={styles.objektList}>
                {objekte.filter(o => o.id !== targetObjekt?.id).map(obj => (
                  <TouchableOpacity
                    key={obj.id}
                    style={styles.objektOption}
                    onPress={() => {
                      setSourceObjekt(obj);
                      setSelectingFor(null);
                    }}
                  >
                    <Text style={styles.objektOptionName}>{obj.name}</Text>
                    <Text style={styles.objektOptionCity}>{obj.city}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <TouchableOpacity
                style={[styles.selectorButton, sourceObjekt && styles.selectorButtonSelected]}
                onPress={() => setSelectingFor('source')}
              >
                {sourceObjekt ? (
                  <View style={styles.selectedObjekt}>
                    <Text style={styles.selectedName}>{sourceObjekt.name}</Text>
                    <Text style={styles.selectedCity}>{sourceObjekt.city}</Text>
                  </View>
                ) : (
                  <Text style={styles.selectorPlaceholder}>Objekt auswählen...</Text>
                )}
                <Feather name="chevron-down" size={20} color="#6B7280" />
              </TouchableOpacity>
            )}

            {/* Target Selection */}
            <Text style={styles.selectorLabel}>Ziel-Objekt (bleibt bestehen):</Text>
            {selectingFor === 'target' ? (
              <ScrollView style={styles.objektList}>
                {objekte.filter(o => o.id !== sourceObjekt?.id).map(obj => (
                  <TouchableOpacity
                    key={obj.id}
                    style={styles.objektOption}
                    onPress={() => {
                      setTargetObjekt(obj);
                      setSelectingFor(null);
                    }}
                  >
                    <Text style={styles.objektOptionName}>{obj.name}</Text>
                    <Text style={styles.objektOptionCity}>{obj.city}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <TouchableOpacity
                style={[styles.selectorButton, targetObjekt && styles.selectorButtonSelected]}
                onPress={() => setSelectingFor('target')}
              >
                {targetObjekt ? (
                  <View style={styles.selectedObjekt}>
                    <Text style={styles.selectedName}>{targetObjekt.name}</Text>
                    <Text style={styles.selectedCity}>{targetObjekt.city}</Text>
                  </View>
                ) : (
                  <Text style={styles.selectorPlaceholder}>Objekt auswählen...</Text>
                )}
                <Feather name="chevron-down" size={20} color="#6B7280" />
              </TouchableOpacity>
            )}

            {/* Merge Preview */}
            {sourceObjekt && targetObjekt && (
              <View style={styles.mergePreview}>
                <Feather name="alert-triangle" size={20} color="#F97316" />
                <Text style={styles.mergePreviewText}>
                  "{sourceObjekt.name}" → "{targetObjekt.name}"
                </Text>
              </View>
            )}

            {/* Action Buttons */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setMergeModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.mergeActionButton,
                  (!sourceObjekt || !targetObjekt || merging) && styles.mergeActionButtonDisabled,
                ]}
                onPress={handleMerge}
                disabled={!sourceObjekt || !targetObjekt || merging}
              >
                {merging ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Feather name="git-merge" size={18} color="#FFFFFF" />
                    <Text style={styles.mergeActionButtonText}>Zusammenlegen</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 28, fontFamily: 'DMSans-Bold', color: '#111827' },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mergeButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  addButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  filterContainer: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  filterTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  filterTabActive: { backgroundColor: '#FFF7ED' },
  filterText: { fontSize: 14, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  filterTextActive: { color: '#F97316' },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { width: 80, height: 80, borderRadius: 20, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 4 },
  emptyText: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#6B7280', textAlign: 'center', marginBottom: 20 },
  emptyButton: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F97316', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  emptyButtonText: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#FFFFFF' },
  objektCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#F3F4F6' },
  objektImage: { width: 80, height: 80, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', position: 'relative' },
  soldOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(34, 197, 94, 0.9)', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  soldOverlayText: { fontSize: 9, fontFamily: 'DMSans-Bold', color: '#FFFFFF' },
  objektContent: { flex: 1, marginLeft: 12 },
  objektHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  objektName: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#111827', flex: 1 },
  aiBadge: { width: 24, height: 24, borderRadius: 6, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  objektCity: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },
  objektDetails: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  objektRooms: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#9CA3AF' },
  objektFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  objektPrice: { fontSize: 16, fontFamily: 'DMSans-Bold', color: '#111827' },

  // Merge Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 20, fontFamily: 'DMSans-Bold', color: '#111827' },
  modalDesc: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#6B7280', marginBottom: 20 },
  selectorLabel: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#374151', marginBottom: 8, marginTop: 12 },
  selectorButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F9FAFB', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  selectorButtonSelected: { borderColor: '#F97316', backgroundColor: '#FFF7ED' },
  selectorPlaceholder: { fontSize: 15, fontFamily: 'DMSans-Regular', color: '#9CA3AF' },
  selectedObjekt: { flex: 1 },
  selectedName: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  selectedCity: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },
  objektList: { maxHeight: 200, backgroundColor: '#F9FAFB', borderRadius: 12, marginBottom: 8 },
  objektOption: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  objektOptionName: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  objektOptionCity: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },
  mergePreview: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF7ED', padding: 16, borderRadius: 12, marginTop: 20 },
  mergePreviewText: { fontSize: 14, fontFamily: 'DMSans-Medium', color: '#F97316', flex: 1 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelButton: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center' },
  cancelButtonText: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#6B7280' },
  mergeActionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: '#F97316' },
  mergeActionButtonDisabled: { backgroundColor: '#D1D5DB' },
  mergeActionButtonText: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#FFFFFF' },
});
