import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
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
    console.log('[DEBUG] loadLeads called - user?.id:', user?.id);

    if (!user?.id) {
      console.log('[DEBUG] loadLeads: No user.id, returning early');
      setLoading(false);  // FIX: Set loading to false even when no user
      return;
    }

    try {
      const data = await getLeads(user.id);
      console.log('[DEBUG] loadLeads: Received data:', data);
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
    if (diffHours < 24) return `vor ${diffHours} Stunden`;
    if (diffDays === 1) return 'gestern';
    return `vor ${diffDays} Tagen`;
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.protectionBanner}>
          <View style={styles.protectionIcon}>
            <Feather name="shield" size={20} color="#F97316" />
          </View>
          <View style={styles.protectionContent}>
            <Text style={styles.protectionTitle}>Lead-Schutz aktiv</Text>
            <Text style={styles.protectionSubtitle}>Alle Simpli-Leads sind 18 Monate geschützt</Text>
          </View>
        </View>

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

        {filteredLeads.map(lead => {
          const status = statusLabels[lead.status] || statusLabels.neu;
          return (
            <TouchableOpacity 
              key={lead.id} 
              style={styles.leadCard}
              onPress={() => router.push(`/chat/${lead.id}`)}
            >
              <View style={styles.leadAvatar}>
                <Text style={styles.leadAvatarText}>
                  {lead.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                </Text>
              </View>
              
              <View style={styles.leadContent}>
                <View style={styles.leadHeader}>
                  <Text style={styles.leadName}>{lead.name}</Text>
                  {lead.source === 'simpli' && (
                    <View style={styles.simpliBadge}>
                      <Feather name="zap" size={10} color="#F97316" />
                    </View>
                  )}
                </View>
                {lead.objekt && (
                  <Text style={styles.leadObjekt}>
                    <Feather name="home" size={12} color="#9CA3AF" /> {lead.objekt.name}
                  </Text>
                )}
                <View style={styles.leadFooter}>
                  <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                    <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                  </View>
                  <Text style={styles.leadTime}>{formatTimeAgo(lead.updated_at)}</Text>
                </View>
              </View>
              
              <Feather name="chevron-right" size={20} color="#D1D5DB" />
            </TouchableOpacity>
          );
        })}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 28, fontFamily: 'DMSans-Bold', color: '#111827' },
  searchButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#F9FAFB', justifyContent: 'center', alignItems: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  protectionBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF7ED', borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: '#FFEDD5' },
  protectionIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
  protectionContent: { flex: 1, marginLeft: 12 },
  protectionTitle: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  protectionSubtitle: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 1 },
  filterContainer: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  filterTab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  filterTabActive: { backgroundColor: '#FFF7ED' },
  filterText: { fontSize: 13, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  filterTextActive: { color: '#F97316' },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { width: 80, height: 80, borderRadius: 20, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 4 },
  emptyText: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#6B7280', textAlign: 'center' },
  leadCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#F3F4F6' },
  leadAvatar: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  leadAvatarText: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#6B7280' },
  leadContent: { flex: 1, marginLeft: 12 },
  leadHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leadName: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  simpliBadge: { width: 20, height: 20, borderRadius: 5, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  leadObjekt: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },
  leadFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontFamily: 'DMSans-SemiBold' },
  leadTime: { fontSize: 11, fontFamily: 'DMSans-Regular', color: '#9CA3AF' },
});
