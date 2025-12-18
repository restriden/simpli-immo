import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Linking, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';
import { getLeads, Lead } from '../../lib/database';
import { supabase } from '../../lib/supabase';

interface Objekt {
  id: string;
  name: string;
}

const statusLabels: Record<string, { label: string; color: string; bg: string }> = {
  neu: { label: 'Neu', color: '#3B82F6', bg: '#DBEAFE' },
  kontaktiert: { label: 'Kontaktiert', color: '#6B7280', bg: '#F3F4F6' },
  simpli_gesendet: { label: 'Simpli gesendet', color: '#F97316', bg: '#FFF7ED' },
  simpli_bestaetigt: { label: 'Simpli Finance', color: '#22C55E', bg: '#D1FAE5' },
  extern_finanziert: { label: 'Extern fin.', color: '#8B5CF6', bg: '#EDE9FE' },
  besichtigt: { label: 'Besichtigt', color: '#3B82F6', bg: '#DBEAFE' },
  abgesagt: { label: 'Abgesagt', color: '#EF4444', bg: '#FEE2E2' },
  gekauft: { label: 'Käufer', color: '#22C55E', bg: '#D1FAE5' },
};

type FilterType = 'alle' | 'objekt' | 'finanzierung';
type FinanzierungFilter = 'alle' | 'simpli' | 'extern';

export default function LeadsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<FilterType>('alle');
  const [selectedObjekt, setSelectedObjekt] = useState<string | null>(null);
  const [finanzierungFilter, setFinanzierungFilter] = useState<FinanzierungFilter>('alle');
  const [showObjektModal, setShowObjektModal] = useState(false);
  const [showFinanzierungModal, setShowFinanzierungModal] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [objekte, setObjekte] = useState<Objekt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadLeads = async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    try {
      const data = await getLeads(user.id);
      // Sort by updated_at descending (newest first)
      const sorted = data.sort((a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      setLeads(sorted);
    } catch (error) {
      console.error('Error loading leads:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadObjekte = async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from('objekte')
        .select('id, name')
        .eq('user_id', user.id)
        .order('name');

      if (!error && data) {
        setObjekte(data);
      }
    } catch (error) {
      console.error('Error loading objekte:', error);
    }
  };

  useEffect(() => {
    loadLeads();
    loadObjekte();
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadLeads();
    }, [user?.id])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadLeads();
    setRefreshing(false);
  };

  // Apply filters
  const filteredLeads = leads.filter(lead => {
    // Objekt filter
    if (activeFilter === 'objekt' && selectedObjekt) {
      if (lead.objekt_id !== selectedObjekt) return false;
    }

    // Finanzierung filter
    if (activeFilter === 'finanzierung' && finanzierungFilter !== 'alle') {
      if (finanzierungFilter === 'simpli') {
        if (lead.status !== 'simpli_bestaetigt') return false;
      } else if (finanzierungFilter === 'extern') {
        if (lead.status !== 'extern_finanziert') return false;
      }
    }

    return true;
  });

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'gerade eben';
    if (diffHours < 24) return `vor ${diffHours}h`;
    if (diffDays === 1) return 'gestern';
    return `vor ${diffDays}d`;
  };

  const handleCall = (phone: string | null | undefined) => {
    if (!phone) {
      Alert.alert('Keine Telefonnummer', 'Für diesen Kontakt ist keine Telefonnummer hinterlegt.');
      return;
    }
    Linking.openURL(`tel:${phone}`);
  };

  const getSelectedObjektName = () => {
    if (!selectedObjekt) return 'Objekt';
    const obj = objekte.find(o => o.id === selectedObjekt);
    return obj?.name || 'Objekt';
  };

  const getFinanzierungLabel = () => {
    if (finanzierungFilter === 'alle') return 'Finanzierung';
    if (finanzierungFilter === 'simpli') return 'Simpli Finance';
    return 'Extern fin.';
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
        <Text style={styles.title}>Leads</Text>
        <View style={styles.headerRight}>
          <Text style={styles.leadCount}>{filteredLeads.length}</Text>
          <TouchableOpacity style={styles.searchButton}>
            <Feather name="search" size={20} color="#6B7280" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Filter Bar */}
      <View style={styles.filterBar}>
        {/* Filter: Alle */}
        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'alle' && styles.filterChipActive]}
          onPress={() => {
            setActiveFilter('alle');
            setSelectedObjekt(null);
            setFinanzierungFilter('alle');
          }}
        >
          <Text style={[styles.filterChipText, activeFilter === 'alle' && styles.filterChipTextActive]}>
            Alle ({leads.length})
          </Text>
        </TouchableOpacity>

        {/* Filter: Objekt (Dropdown) */}
        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'objekt' && styles.filterChipActive]}
          onPress={() => setShowObjektModal(true)}
        >
          <Text
            style={[styles.filterChipText, activeFilter === 'objekt' && styles.filterChipTextActive]}
            numberOfLines={1}
          >
            {activeFilter === 'objekt' && selectedObjekt ? getSelectedObjektName() : 'Objekt'}
          </Text>
          <Feather
            name="chevron-down"
            size={14}
            color={activeFilter === 'objekt' ? '#F97316' : '#6B7280'}
            style={{ marginLeft: 4 }}
          />
        </TouchableOpacity>

        {/* Filter: Finanzierung (Dropdown) */}
        <TouchableOpacity
          style={[styles.filterChip, activeFilter === 'finanzierung' && styles.filterChipActive]}
          onPress={() => setShowFinanzierungModal(true)}
        >
          <Text style={[styles.filterChipText, activeFilter === 'finanzierung' && styles.filterChipTextActive]}>
            {activeFilter === 'finanzierung' ? getFinanzierungLabel() : 'Finanzierung'}
          </Text>
          <Feather
            name="chevron-down"
            size={14}
            color={activeFilter === 'finanzierung' ? '#F97316' : '#6B7280'}
            style={{ marginLeft: 4 }}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F97316" />
        }
      >
        {/* Empty State */}
        {filteredLeads.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Feather name="users" size={48} color="#D1D5DB" />
            </View>
            <Text style={styles.emptyTitle}>Keine Leads gefunden</Text>
            <Text style={styles.emptyText}>
              {activeFilter !== 'alle'
                ? 'Versuche einen anderen Filter.'
                : 'Leads werden hier erscheinen, sobald sich Interessenten melden.'}
            </Text>
          </View>
        )}

        {/* Lead Cards */}
        {filteredLeads.map(lead => {
          const status = statusLabels[lead.status] || statusLabels.neu;

          return (
            <TouchableOpacity
              key={lead.id}
              style={styles.leadCard}
              onPress={() => router.push(`/lead/${lead.id}`)}
              activeOpacity={0.7}
            >
              {/* Left: Avatar */}
              <View style={styles.leadAvatar}>
                <Text style={styles.leadAvatarText}>
                  {lead.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                </Text>
              </View>

              {/* Middle: Info */}
              <View style={styles.leadInfo}>
                <View style={styles.leadNameRow}>
                  <Text style={styles.leadName} numberOfLines={1}>{lead.name}</Text>
                  {lead.source === 'simpli' && (
                    <View style={styles.simpliBadge}>
                      <Feather name="zap" size={10} color="#F97316" />
                    </View>
                  )}
                </View>
                <View style={styles.leadMeta}>
                  <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                    <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                  </View>
                  <Text style={styles.leadTime}>{formatTimeAgo(lead.updated_at)}</Text>
                </View>
              </View>

              {/* Right: Actions */}
              <View style={styles.leadActions}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    handleCall(lead.phone);
                  }}
                >
                  <Feather name="phone" size={16} color="#22C55E" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    router.push(`/chat/${lead.id}`);
                  }}
                >
                  <Feather name="message-circle" size={16} color="#F97316" />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Objekt Selection Modal */}
      <Modal
        visible={showObjektModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowObjektModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowObjektModal(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Nach Objekt filtern</Text>

            <TouchableOpacity
              style={[styles.modalOption, !selectedObjekt && activeFilter === 'objekt' && styles.modalOptionActive]}
              onPress={() => {
                setActiveFilter('objekt');
                setSelectedObjekt(null);
                setShowObjektModal(false);
              }}
            >
              <Text style={styles.modalOptionText}>Alle Objekte</Text>
              {!selectedObjekt && activeFilter === 'objekt' && (
                <Feather name="check" size={18} color="#F97316" />
              )}
            </TouchableOpacity>

            {objekte.map(obj => (
              <TouchableOpacity
                key={obj.id}
                style={[styles.modalOption, selectedObjekt === obj.id && styles.modalOptionActive]}
                onPress={() => {
                  setActiveFilter('objekt');
                  setSelectedObjekt(obj.id);
                  setShowObjektModal(false);
                }}
              >
                <Text style={styles.modalOptionText} numberOfLines={1}>{obj.name}</Text>
                {selectedObjekt === obj.id && (
                  <Feather name="check" size={18} color="#F97316" />
                )}
              </TouchableOpacity>
            ))}

            {objekte.length === 0 && (
              <Text style={styles.modalEmpty}>Keine Objekte vorhanden</Text>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Finanzierung Selection Modal */}
      <Modal
        visible={showFinanzierungModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFinanzierungModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowFinanzierungModal(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Nach Finanzierung filtern</Text>

            <TouchableOpacity
              style={[styles.modalOption, finanzierungFilter === 'alle' && activeFilter === 'finanzierung' && styles.modalOptionActive]}
              onPress={() => {
                setActiveFilter('finanzierung');
                setFinanzierungFilter('alle');
                setShowFinanzierungModal(false);
              }}
            >
              <Text style={styles.modalOptionText}>Alle</Text>
              {finanzierungFilter === 'alle' && activeFilter === 'finanzierung' && (
                <Feather name="check" size={18} color="#F97316" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalOption, finanzierungFilter === 'simpli' && styles.modalOptionActive]}
              onPress={() => {
                setActiveFilter('finanzierung');
                setFinanzierungFilter('simpli');
                setShowFinanzierungModal(false);
              }}
            >
              <View style={styles.modalOptionRow}>
                <View style={[styles.finanzBadge, { backgroundColor: '#D1FAE5' }]}>
                  <Feather name="zap" size={12} color="#22C55E" />
                </View>
                <Text style={styles.modalOptionText}>Simpli Finance</Text>
              </View>
              {finanzierungFilter === 'simpli' && (
                <Feather name="check" size={18} color="#F97316" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalOption, finanzierungFilter === 'extern' && styles.modalOptionActive]}
              onPress={() => {
                setActiveFilter('finanzierung');
                setFinanzierungFilter('extern');
                setShowFinanzierungModal(false);
              }}
            >
              <View style={styles.modalOptionRow}>
                <View style={[styles.finanzBadge, { backgroundColor: '#EDE9FE' }]}>
                  <Feather name="briefcase" size={12} color="#8B5CF6" />
                </View>
                <Text style={styles.modalOptionText}>Extern finanziert</Text>
              </View>
              {finanzierungFilter === 'extern' && (
                <Feather name="check" size={18} color="#F97316" />
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB'
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontSize: 24,
    fontFamily: 'DMSans-Bold',
    color: '#111827'
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  leadCount: {
    fontSize: 16,
    fontFamily: 'DMSans-SemiBold',
    color: '#6B7280',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  searchButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center'
  },
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  filterChipActive: {
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#F97316',
  },
  filterChipText: {
    fontSize: 13,
    fontFamily: 'DMSans-Medium',
    color: '#6B7280',
    maxWidth: 100,
  },
  filterChipTextActive: {
    color: '#F97316'
  },
  scrollView: {
    flex: 1
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'DMSans-SemiBold',
    color: '#111827',
    marginBottom: 4
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'DMSans-Regular',
    color: '#6B7280',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  leadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  leadAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center'
  },
  leadAvatarText: {
    fontSize: 14,
    fontFamily: 'DMSans-SemiBold',
    color: '#6B7280'
  },
  leadInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  leadNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  leadName: {
    fontSize: 15,
    fontFamily: 'DMSans-SemiBold',
    color: '#111827',
    flexShrink: 1,
  },
  simpliBadge: {
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center'
  },
  leadMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  statusText: {
    fontSize: 10,
    fontFamily: 'DMSans-SemiBold'
  },
  leadTime: {
    fontSize: 11,
    fontFamily: 'DMSans-Regular',
    color: '#9CA3AF'
  },
  leadActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 340,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'DMSans-Bold',
    color: '#111827',
    marginBottom: 16,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  modalOptionActive: {
    backgroundColor: '#FFF7ED',
    marginHorizontal: -20,
    paddingHorizontal: 20,
  },
  modalOptionText: {
    fontSize: 15,
    fontFamily: 'DMSans-Medium',
    color: '#374151',
    flex: 1,
  },
  modalOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  modalEmpty: {
    fontSize: 14,
    fontFamily: 'DMSans-Regular',
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 20,
  },
  finanzBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
