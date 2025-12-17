import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

const mockLeads = [
  { id: '1', name: 'Max Mustermann', objektName: 'Musterstraße 5', status: 'simpli_bestaetigt', source: 'simpli', lastMessage: 'vor 2 Stunden' },
  { id: '2', name: 'Anna Schmidt', objektName: 'Musterstraße 5', status: 'simpli_gesendet', source: 'simpli', lastMessage: 'vor 1 Tag' },
  { id: '3', name: 'Peter Meier', objektName: 'Beispielweg 10', status: 'besichtigt', source: 'extern', lastMessage: 'vor 3 Tagen' },
  { id: '4', name: 'Lisa Weber', objektName: 'Musterstraße 5', status: 'kontaktiert', source: 'extern', lastMessage: 'vor 5 Stunden' },
];

const statusLabels: Record<string, { label: string; color: string; bg: string }> = {
  neu: { label: 'Neu', color: '#3B82F6', bg: '#DBEAFE' },
  kontaktiert: { label: 'Kontaktiert', color: '#6B7280', bg: '#F3F4F6' },
  simpli_gesendet: { label: 'Simpli gesendet', color: '#F97316', bg: '#FFF7ED' },
  simpli_bestaetigt: { label: 'Finanziert', color: '#22C55E', bg: '#D1FAE5' },
  besichtigt: { label: 'Besichtigt', color: '#3B82F6', bg: '#DBEAFE' },
};

export default function LeadsScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<'alle' | 'simpli' | 'extern'>('alle');

  const filteredLeads = mockLeads.filter(lead => {
    if (filter === 'alle') return true;
    return lead.source === filter;
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Leads</Text>
        <TouchableOpacity style={styles.searchButton}>
          <Feather name="search" size={22} color="#6B7280" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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
                {f.charAt(0).toUpperCase() + f.slice(1)} ({mockLeads.filter(l => f === 'alle' || l.source === f).length})
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {filteredLeads.map(lead => {
          const status = statusLabels[lead.status] || statusLabels.neu;
          return (
            <TouchableOpacity 
              key={lead.id} 
              style={styles.leadCard}
              onPress={() => router.push(`/chat/${lead.id}`)}
            >
              <View style={styles.leadAvatar}>
                <Text style={styles.leadAvatarText}>{lead.name.split(' ').map(n => n[0]).join('')}</Text>
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
                <Text style={styles.leadObjekt}><Feather name="home" size={12} color="#9CA3AF" /> {lead.objektName}</Text>
                <View style={styles.leadFooter}>
                  <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                    <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                  </View>
                  <Text style={styles.leadTime}>{lead.lastMessage}</Text>
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
