import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { getObjekt, getLeadsByObjekt, getObjektStats, Objekt, Lead } from '../../lib/database';

const statusLabels: Record<string, { label: string; color: string; bg: string }> = {
  aktiv: { label: 'Aktiv', color: '#22C55E', bg: '#D1FAE5' },
  verkauft: { label: 'Verkauft', color: '#3B82F6', bg: '#DBEAFE' },
  pausiert: { label: 'Pausiert', color: '#6B7280', bg: '#F3F4F6' },
};

export default function ObjektDetailScreen() {
  const router = useRouter();
  const { objektId } = useLocalSearchParams<{ objektId: string }>();
  const [objekt, setObjekt] = useState<Objekt | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState({
    anfragen: 0,
    kontaktiert: 0,
    simpliGesendet: 0,
    simpliBestaetigt: 0,
    externFinanziert: 0,
    besichtigungen: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [objektId]);

  const loadData = async () => {
    if (!objektId) return;

    try {
      const [objektData, leadsData, statsData] = await Promise.all([
        getObjekt(objektId),
        getLeadsByObjekt(objektId),
        getObjektStats(objektId),
      ]);

      setObjekt(objektData);
      setLeads(leadsData);
      setStats(statsData);
    } catch (error) {
      console.error('Error loading objekt:', error);
    } finally {
      setLoading(false);
    }
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

  if (!objekt) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Feather name="arrow-left" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Objekt nicht gefunden</Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>
    );
  }

  const status = statusLabels[objekt.status] || statusLabels.aktiv;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{objekt.name}</Text>
        <TouchableOpacity style={styles.menuButton}>
          <Feather name="more-vertical" size={20} color="#6B7280" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Image Placeholder */}
        <View style={styles.heroImage}>
          <Feather name="home" size={64} color="#D1D5DB" />
          {objekt.status === 'verkauft' && (
            <View style={styles.soldBadge}>
              <Text style={styles.soldBadgeText}>VERKAUFT</Text>
            </View>
          )}
        </View>

        {/* Info Card */}
        <View style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <View>
              <Text style={styles.objektName}>{objekt.name}</Text>
              <Text style={styles.objektCity}>
                <Feather name="map-pin" size={14} color="#6B7280" /> {objekt.city}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
              <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
            </View>
          </View>

          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Preis</Text>
            <Text style={styles.priceValue}>€{objekt.price?.toLocaleString('de-DE')}</Text>
          </View>

          <View style={styles.detailsRow}>
            <View style={styles.detailItem}>
              <Feather name="grid" size={18} color="#6B7280" />
              <Text style={styles.detailText}>{objekt.rooms} Zimmer</Text>
            </View>
            <View style={styles.detailItem}>
              <Feather name="maximize" size={18} color="#6B7280" />
              <Text style={styles.detailText}>{objekt.area_sqm} m²</Text>
            </View>
            {objekt.ai_ready && (
              <View style={styles.detailItem}>
                <Feather name="cpu" size={18} color="#F97316" />
                <Text style={[styles.detailText, { color: '#F97316' }]}>KI aktiv</Text>
              </View>
            )}
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsSection}>
          <Text style={styles.sectionTitle}>Lead-Funnel</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.anfragen}</Text>
              <Text style={styles.statLabel}>Anfragen</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.kontaktiert}</Text>
              <Text style={styles.statLabel}>Kontaktiert</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.simpliBestaetigt}</Text>
              <Text style={styles.statLabel}>Finanziert</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.besichtigungen}</Text>
              <Text style={styles.statLabel}>Besichtigt</Text>
            </View>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actionsSection}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push(`/ki-wissen/${objektId}`)}
          >
            <View style={[styles.actionIcon, { backgroundColor: '#FFF7ED' }]}>
              <Feather name="book-open" size={20} color="#F97316" />
            </View>
            <View style={styles.actionContent}>
              <Text style={styles.actionTitle}>KI-Wissen</Text>
              <Text style={styles.actionSubtitle}>Objektinfos verwalten</Text>
            </View>
            <Feather name="chevron-right" size={20} color="#D1D5DB" />
          </TouchableOpacity>
        </View>

        {/* Leads */}
        <View style={styles.leadsSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Leads ({leads.length})</Text>
          </View>

          {leads.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Noch keine Leads für dieses Objekt</Text>
            </View>
          ) : (
            leads.slice(0, 5).map((lead) => (
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
                  <Text style={styles.leadName}>{lead.name}</Text>
                  <Text style={styles.leadStatus}>{lead.status}</Text>
                </View>
                <Feather name="chevron-right" size={20} color="#D1D5DB" />
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  backButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontFamily: 'DMSans-SemiBold', color: '#111827', flex: 1, textAlign: 'center', marginHorizontal: 12 },
  menuButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 20 },
  heroImage: { height: 200, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', position: 'relative' },
  soldBadge: { position: 'absolute', top: 16, right: 16, backgroundColor: '#22C55E', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  soldBadgeText: { fontSize: 12, fontFamily: 'DMSans-Bold', color: '#FFFFFF' },
  infoCard: { backgroundColor: '#FFFFFF', padding: 20, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  infoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  objektName: { fontSize: 22, fontFamily: 'DMSans-Bold', color: '#111827', marginBottom: 4 },
  objektCity: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#6B7280' },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  statusText: { fontSize: 12, fontFamily: 'DMSans-SemiBold' },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  priceLabel: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#6B7280' },
  priceValue: { fontSize: 24, fontFamily: 'DMSans-Bold', color: '#111827' },
  detailsRow: { flexDirection: 'row', gap: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailText: { fontSize: 14, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  statsSection: { padding: 20 },
  sectionTitle: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 12 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCard: { width: '47%', backgroundColor: '#F9FAFB', borderRadius: 12, padding: 16, alignItems: 'center' },
  statValue: { fontSize: 24, fontFamily: 'DMSans-Bold', color: '#111827' },
  statLabel: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 4 },
  actionsSection: { paddingHorizontal: 20, marginBottom: 20 },
  actionButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#F3F4F6' },
  actionIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  actionContent: { flex: 1, marginLeft: 12 },
  actionTitle: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  actionSubtitle: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },
  leadsSection: { paddingHorizontal: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  emptyState: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 24, alignItems: 'center' },
  emptyText: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#6B7280' },
  leadCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#F3F4F6' },
  leadAvatar: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  leadAvatarText: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#6B7280' },
  leadContent: { flex: 1, marginLeft: 12 },
  leadName: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  leadStatus: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },
});
