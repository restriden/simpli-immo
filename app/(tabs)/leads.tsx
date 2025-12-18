import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';
import { getLeads, Lead } from '../../lib/database';

const statusLabels: Record<string, { label: string; color: string; bg: string }> = {
  neu: { label: 'Neu', color: '#3B82F6', bg: '#DBEAFE' },
  kontaktiert: { label: 'Kontaktiert', color: '#6B7280', bg: '#F3F4F6' },
  simpli_gesendet: { label: 'Simpli gesendet', color: '#F97316', bg: '#FFF7ED' },
  simpli_bestaetigt: { label: 'Finanziert', color: '#22C55E', bg: '#D1FAE5' },
  extern_finanziert: { label: 'Extern fin.', color: '#8B5CF6', bg: '#EDE9FE' },
  besichtigt: { label: 'Besichtigt', color: '#3B82F6', bg: '#DBEAFE' },
  abgesagt: { label: 'Abgesagt', color: '#EF4444', bg: '#FEE2E2' },
  gekauft: { label: 'Käufer', color: '#22C55E', bg: '#D1FAE5' },
};

export default function LeadsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<'alle' | 'simpli' | 'extern'>('alle');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadLeads = async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    try {
      const data = await getLeads(user.id);
      setLeads(data);
    } catch (error) {
      console.error('Error loading leads:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLeads();
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

  const filteredLeads = leads.filter(lead => {
    if (filter === 'alle') return true;
    return lead.source === filter;
  });

  const getLeadCounts = (source: string) => {
    if (source === 'alle') return leads.length;
    return leads.filter(l => l.source === source).length;
  };

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
        <TouchableOpacity style={styles.searchButton}>
          <Feather name="search" size={22} color="#6B7280" />
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
        {/* Filter Tabs */}
        <View style={styles.filterContainer}>
          {['alle', 'simpli', 'extern'].map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterTab, filter === f && styles.filterTabActive]}
              onPress={() => setFilter(f as any)}
            >
              {f === 'simpli' && <Feather name="zap" size={14} color={filter === f ? '#F97316' : '#6B7280'} style={{ marginRight: 4 }} />}
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                {f.charAt(0).toUpperCase() + f.slice(1)} ({getLeadCounts(f)})
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Empty State */}
        {filteredLeads.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Feather name="users" size={48} color="#D1D5DB" />
            </View>
            <Text style={styles.emptyTitle}>Noch keine Leads</Text>
            <Text style={styles.emptyText}>
              Leads werden hier erscheinen, sobald sich Interessenten melden.
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
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  title: {
    fontSize: 24,
    fontFamily: 'DMSans-Bold',
    color: '#111827'
  },
  searchButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center'
  },
  scrollView: {
    flex: 1
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  filterContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  filterTabActive: {
    backgroundColor: '#FFF7ED',
    borderColor: '#F97316',
  },
  filterText: {
    fontSize: 13,
    fontFamily: 'DMSans-Medium',
    color: '#6B7280'
  },
  filterTextActive: {
    color: '#F97316'
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
    textAlign: 'center'
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
});
