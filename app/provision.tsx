import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

// Mock Provision Daten
const mockStats = {
  gesamtJahr: 47850,
  gesamtMonat: 8200,
  simpliAnteil: 12450,
  maklerAnteil: 35400,
  offeneProvisionen: 15600,
  inBearbeitung: 3,
};

const mockMonatsDaten = [
  { monat: 'Jul', simpli: 1200, makler: 4500 },
  { monat: 'Aug', simpli: 800, makler: 3200 },
  { monat: 'Sep', simpli: 2100, makler: 5800 },
  { monat: 'Okt', simpli: 1500, makler: 6200 },
  { monat: 'Nov', simpli: 2400, makler: 7100 },
  { monat: 'Dez', simpli: 1800, makler: 6400 },
];

const mockTransaktionen = [
  {
    id: '1',
    typ: 'simpli',
    status: 'ausgezahlt',
    betrag: 2400,
    objektName: 'Testgasse 3',
    kaeuferName: 'Maria Weber',
    kreditSumme: 240000,
    datum: '15.12.2024',
  },
  {
    id: '2',
    typ: 'makler',
    status: 'ausgezahlt',
    betrag: 13500,
    objektName: 'Testgasse 3',
    kaeuferName: 'Maria Weber',
    verkaufspreis: 275000,
    datum: '15.12.2024',
  },
  {
    id: '3',
    typ: 'simpli',
    status: 'in_bearbeitung',
    betrag: 1800,
    objektName: 'Musterstraße 5',
    kaeuferName: 'Max Mustermann',
    kreditSumme: 180000,
    datum: 'Erwartet: Jan 2025',
  },
  {
    id: '4',
    typ: 'simpli',
    status: 'offen',
    betrag: 2200,
    objektName: 'Musterstraße 5',
    kaeuferName: 'Anna Schmidt',
    kreditSumme: 220000,
    datum: 'Finanzierung läuft',
  },
  {
    id: '5',
    typ: 'makler',
    status: 'offen',
    betrag: 11600,
    objektName: 'Musterstraße 5',
    kaeuferName: 'Offen',
    verkaufspreis: 450000,
    datum: 'Nach Verkauf',
  },
];

const statusLabels: Record<string, { label: string; color: string; bg: string }> = {
  ausgezahlt: { label: 'Ausgezahlt', color: '#22C55E', bg: '#D1FAE5' },
  in_bearbeitung: { label: 'In Bearbeitung', color: '#F97316', bg: '#FFF7ED' },
  offen: { label: 'Offen', color: '#6B7280', bg: '#F3F4F6' },
};

export default function ProvisionScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<'alle' | 'simpli' | 'makler'>('alle');
  const [zeitraum, setZeitraum] = useState<'monat' | 'jahr'>('jahr');

  const filteredTransaktionen = mockTransaktionen.filter(t => {
    if (filter === 'alle') return true;
    return t.typ === filter;
  });

  const maxChartValue = Math.max(...mockMonatsDaten.map(d => d.simpli + d.makler));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Provisionen</Text>
        <TouchableOpacity style={styles.exportButton}>
          <Feather name="download" size={20} color="#6B7280" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hauptkarte */}
        <View style={styles.mainCard}>
          <View style={styles.mainCardHeader}>
            <Text style={styles.mainCardLabel}>Gesamtverdienst 2024</Text>
            <View style={styles.zeitraumToggle}>
              <TouchableOpacity
                style={[styles.zeitraumButton, zeitraum === 'monat' && styles.zeitraumButtonActive]}
                onPress={() => setZeitraum('monat')}
              >
                <Text style={[styles.zeitraumText, zeitraum === 'monat' && styles.zeitraumTextActive]}>Monat</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.zeitraumButton, zeitraum === 'jahr' && styles.zeitraumButtonActive]}
                onPress={() => setZeitraum('jahr')}
              >
                <Text style={[styles.zeitraumText, zeitraum === 'jahr' && styles.zeitraumTextActive]}>Jahr</Text>
              </TouchableOpacity>
            </View>
          </View>
          
          <Text style={styles.mainCardValue}>
            €{(zeitraum === 'jahr' ? mockStats.gesamtJahr : mockStats.gesamtMonat).toLocaleString('de-DE')}
          </Text>
          
          <View style={styles.mainCardBreakdown}>
            <View style={styles.breakdownItem}>
              <View style={[styles.breakdownDot, { backgroundColor: '#F97316' }]} />
              <Text style={styles.breakdownLabel}>Simpli Finance</Text>
              <Text style={styles.breakdownValue}>€{mockStats.simpliAnteil.toLocaleString('de-DE')}</Text>
            </View>
            <View style={styles.breakdownItem}>
              <View style={[styles.breakdownDot, { backgroundColor: '#3B82F6' }]} />
              <Text style={styles.breakdownLabel}>Makler-Provision</Text>
              <Text style={styles.breakdownValue}>€{mockStats.maklerAnteil.toLocaleString('de-DE')}</Text>
            </View>
          </View>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: '#FFF7ED' }]}>
              <Feather name="clock" size={20} color="#F97316" />
            </View>
            <Text style={styles.statValue}>€{mockStats.offeneProvisionen.toLocaleString('de-DE')}</Text>
            <Text style={styles.statLabel}>Offen / Erwartet</Text>
          </View>
          
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: '#DBEAFE' }]}>
              <Feather name="loader" size={20} color="#3B82F6" />
            </View>
            <Text style={styles.statValue}>{mockStats.inBearbeitung}</Text>
            <Text style={styles.statLabel}>In Bearbeitung</Text>
          </View>
        </View>

        {/* Chart */}
        <View style={styles.chartSection}>
          <Text style={styles.sectionTitle}>Monatlicher Verlauf</Text>
          <View style={styles.chartContainer}>
            <View style={styles.chartLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#F97316' }]} />
                <Text style={styles.legendText}>Simpli</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#3B82F6' }]} />
                <Text style={styles.legendText}>Makler</Text>
              </View>
            </View>
            
            <View style={styles.chart}>
              {mockMonatsDaten.map((daten, index) => {
                const totalHeight = ((daten.simpli + daten.makler) / maxChartValue) * 120;
                const simpliHeight = (daten.simpli / (daten.simpli + daten.makler)) * totalHeight;
                const maklerHeight = totalHeight - simpliHeight;
                
                return (
                  <View key={index} style={styles.chartColumn}>
                    <View style={styles.chartBar}>
                      <View style={[styles.chartBarSegment, { height: maklerHeight, backgroundColor: '#3B82F6' }]} />
                      <View style={[styles.chartBarSegment, { height: simpliHeight, backgroundColor: '#F97316', borderBottomLeftRadius: 4, borderBottomRightRadius: 4 }]} />
                    </View>
                    <Text style={styles.chartLabel}>{daten.monat}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        {/* Filter */}
        <View style={styles.filterSection}>
          <Text style={styles.sectionTitle}>Transaktionen</Text>
          <View style={styles.filterContainer}>
            {[
              { key: 'alle', label: 'Alle' },
              { key: 'simpli', label: 'Simpli', icon: 'zap' },
              { key: 'makler', label: 'Makler', icon: 'home' },
            ].map((f) => (
              <TouchableOpacity
                key={f.key}
                style={[styles.filterTab, filter === f.key && styles.filterTabActive]}
                onPress={() => setFilter(f.key as any)}
              >
                {f.icon && (
                  <Feather 
                    name={f.icon as any} 
                    size={14} 
                    color={filter === f.key ? '#F97316' : '#6B7280'} 
                    style={{ marginRight: 4 }} 
                  />
                )}
                <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Transaktionen Liste */}
        {filteredTransaktionen.map((transaktion) => {
          const status = statusLabels[transaktion.status];
          const isSimpli = transaktion.typ === 'simpli';
          
          return (
            <View key={transaktion.id} style={styles.transaktionCard}>
              <View style={styles.transaktionHeader}>
                <View style={styles.transaktionTyp}>
                  <View style={[styles.typIcon, { backgroundColor: isSimpli ? '#FFF7ED' : '#DBEAFE' }]}>
                    <Feather 
                      name={isSimpli ? 'zap' : 'home'} 
                      size={16} 
                      color={isSimpli ? '#F97316' : '#3B82F6'} 
                    />
                  </View>
                  <View>
                    <Text style={styles.transaktionObjekt}>{transaktion.objektName}</Text>
                    <Text style={styles.transaktionKaeufer}>{transaktion.kaeuferName}</Text>
                  </View>
                </View>
                <View style={styles.transaktionBetrag}>
                  <Text style={[styles.betragValue, { color: isSimpli ? '#F97316' : '#3B82F6' }]}>
                    +€{transaktion.betrag.toLocaleString('de-DE')}
                  </Text>
                  <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                    <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                  </View>
                </View>
              </View>
              
              <View style={styles.transaktionFooter}>
                <Text style={styles.transaktionDetail}>
                  {isSimpli 
                    ? `Kredit: €${transaktion.kreditSumme?.toLocaleString('de-DE')} (1% Provision)`
                    : `Verkauf: €${transaktion.verkaufspreis?.toLocaleString('de-DE')}`
                  }
                </Text>
                <Text style={styles.transaktionDatum}>{transaktion.datum}</Text>
              </View>
            </View>
          );
        })}

        {/* Simpli Info Banner */}
        <View style={styles.infoBanner}>
          <View style={styles.infoIcon}>
            <Feather name="info" size={20} color="#F97316" />
          </View>
          <View style={styles.infoContent}>
            <Text style={styles.infoTitle}>Simpli Finance Provision</Text>
            <Text style={styles.infoText}>
              Du erhältst 1% der Kreditsumme wenn dein Lead über Simpli Finance finanziert.
              Die Provision wird nach Kreditauszahlung überwiesen.
            </Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  backButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  exportButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16 },
  mainCard: { backgroundColor: '#111827', borderRadius: 20, padding: 20, marginBottom: 16 },
  mainCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  mainCardLabel: { fontSize: 14, fontFamily: 'DMSans-Regular', color: 'rgba(255,255,255,0.7)' },
  zeitraumToggle: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8, padding: 2 },
  zeitraumButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  zeitraumButtonActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  zeitraumText: { fontSize: 12, fontFamily: 'DMSans-Medium', color: 'rgba(255,255,255,0.5)' },
  zeitraumTextActive: { color: '#FFFFFF' },
  mainCardValue: { fontSize: 36, fontFamily: 'DMSans-Bold', color: '#FFFFFF', marginBottom: 16 },
  mainCardBreakdown: { gap: 8 },
  breakdownItem: { flexDirection: 'row', alignItems: 'center' },
  breakdownDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  breakdownLabel: { flex: 1, fontSize: 14, fontFamily: 'DMSans-Regular', color: 'rgba(255,255,255,0.7)' },
  breakdownValue: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#FFFFFF' },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#F3F4F6' },
  statIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  statValue: { fontSize: 20, fontFamily: 'DMSans-Bold', color: '#111827', marginBottom: 2 },
  statLabel: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#6B7280', textAlign: 'center' },
  chartSection: { marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 12 },
  chartContainer: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#F3F4F6' },
  chartLegend: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginBottom: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  chart: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 150, paddingTop: 20 },
  chartColumn: { alignItems: 'center', flex: 1 },
  chartBar: { width: 28, borderRadius: 4, overflow: 'hidden', justifyContent: 'flex-end' },
  chartBarSegment: { width: '100%' },
  chartLabel: { fontSize: 11, fontFamily: 'DMSans-Medium', color: '#9CA3AF', marginTop: 8 },
  filterSection: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  filterContainer: { flexDirection: 'row', gap: 8 },
  filterTab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F3F4F6' },
  filterTabActive: { backgroundColor: '#FFF7ED', borderColor: '#FFEDD5' },
  filterText: { fontSize: 13, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  filterTextActive: { color: '#F97316' },
  transaktionCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#F3F4F6' },
  transaktionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  transaktionTyp: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  typIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  transaktionObjekt: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  transaktionKaeufer: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 1 },
  transaktionBetrag: { alignItems: 'flex-end' },
  betragValue: { fontSize: 18, fontFamily: 'DMSans-Bold' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginTop: 4 },
  statusText: { fontSize: 11, fontFamily: 'DMSans-SemiBold' },
  transaktionFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  transaktionDetail: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#6B7280' },
  transaktionDatum: { fontSize: 12, fontFamily: 'DMSans-Medium', color: '#9CA3AF' },
  infoBanner: { flexDirection: 'row', backgroundColor: '#FFF7ED', borderRadius: 16, padding: 16, marginTop: 8, borderWidth: 1, borderColor: '#FFEDD5' },
  infoIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
  infoContent: { flex: 1, marginLeft: 12 },
  infoTitle: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 4 },
  infoText: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', lineHeight: 18 },
});
