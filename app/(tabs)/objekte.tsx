import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

const mockObjekte = [
  {
    id: '1',
    name: 'Musterstraße 5',
    city: 'Hamburg-Eppendorf',
    price: 450000,
    type: 'Eigentumswohnung',
    rooms: '3 Zimmer · 85m²',
    status: 'aktiv',
    aiReady: true,
    stats: { anfragen: 12, besichtigungen: 5 },
  },
  {
    id: '2',
    name: 'Beispielweg 10',
    city: 'Hamburg-Winterhude',
    price: 320000,
    type: 'Eigentumswohnung',
    rooms: '2 Zimmer · 62m²',
    status: 'aktiv',
    aiReady: true,
    stats: { anfragen: 8, besichtigungen: 2 },
  },
  {
    id: '3',
    name: 'Testgasse 3',
    city: 'Hamburg-Eimsbüttel',
    price: 275000,
    type: 'Eigentumswohnung',
    rooms: '2 Zimmer · 55m²',
    status: 'verkauft',
    aiReady: false,
    verkauftMitSimpli: true,
  },
];

export default function ObjekteScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<'alle' | 'aktiv' | 'verkauft'>('alle');

  const filteredObjekte = mockObjekte.filter(obj => {
    if (filter === 'alle') return true;
    return obj.status === filter;
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Objekte</Text>
        <TouchableOpacity 
          style={styles.addButton}
          onPress={() => router.push('/magic-upload')}
        >
          <Feather name="plus" size={24} color="#F97316" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity 
          style={styles.magicCard}
          onPress={() => router.push('/magic-upload')}
        >
          <View style={styles.magicIconContainer}>
            <Feather name="upload" size={24} color="#FFFFFF" />
          </View>
          <View style={styles.magicContent}>
            <Text style={styles.magicTitle}>Magic Upload</Text>
            <Text style={styles.magicSubtitle}>
              Lade Exposé hoch – KI extrahiert alle Daten
            </Text>
          </View>
          <View style={styles.magicArrow}>
            <Feather name="arrow-right" size={20} color="#FFFFFF" />
          </View>
        </TouchableOpacity>

        <View style={styles.filterContainer}>
          {['alle', 'aktiv', 'verkauft'].map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterTab, filter === f && styles.filterTabActive]}
              onPress={() => setFilter(f as any)}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                {f.charAt(0).toUpperCase() + f.slice(1)} ({mockObjekte.filter(o => f === 'alle' || o.status === f).length})
              </Text>
            </TouchableOpacity>
          ))}
        </View>

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
                <Text style={styles.objektName}>{objekt.name}</Text>
                {objekt.status === 'verkauft' && objekt.verkauftMitSimpli && (
                  <View style={styles.simpliBadge}>
                    <Feather name="zap" size={10} color="#F97316" />
                    <Text style={styles.simpliBadgeText}>Simpli</Text>
                  </View>
                )}
                {objekt.aiReady && objekt.status !== 'verkauft' && (
                  <View style={styles.aiBadge}>
                    <Feather name="cpu" size={12} color="#F97316" />
                  </View>
                )}
              </View>
              
              <Text style={styles.objektCity}>
                <Feather name="map-pin" size={12} color="#9CA3AF" /> {objekt.city}
              </Text>
              
              <View style={styles.objektDetails}>
                <Text style={styles.objektType}>{objekt.type}</Text>
                <Text style={styles.objektRooms}>{objekt.rooms}</Text>
              </View>
              
              <View style={styles.objektFooter}>
                <Text style={styles.objektPrice}>
                  €{objekt.price.toLocaleString('de-DE')}
                </Text>
                {objekt.status === 'aktiv' && objekt.stats && (
                  <View style={styles.objektStats}>
                    <View style={styles.statItem}>
                      <Feather name="users" size={12} color="#6B7280" />
                      <Text style={styles.statText}>{objekt.stats.anfragen}</Text>
                    </View>
                    <View style={styles.statItem}>
                      <Feather name="eye" size={12} color="#6B7280" />
                      <Text style={styles.statText}>{objekt.stats.besichtigungen}</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
            
            <Feather name="chevron-right" size={20} color="#D1D5DB" />
          </TouchableOpacity>
        ))}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 28, fontFamily: 'DMSans-Bold', color: '#111827' },
  addButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  magicCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F97316', borderRadius: 16, padding: 16, marginBottom: 20 },
  magicIconContainer: { width: 48, height: 48, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  magicContent: { flex: 1, marginLeft: 12 },
  magicTitle: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#FFFFFF' },
  magicSubtitle: { fontSize: 13, fontFamily: 'DMSans-Regular', color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  magicArrow: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  filterContainer: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  filterTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  filterTabActive: { backgroundColor: '#FFF7ED' },
  filterText: { fontSize: 14, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  filterTextActive: { color: '#F97316' },
  objektCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#F3F4F6' },
  objektImage: { width: 80, height: 80, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', position: 'relative' },
  soldOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(34, 197, 94, 0.9)', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  soldOverlayText: { fontSize: 9, fontFamily: 'DMSans-Bold', color: '#FFFFFF' },
  objektContent: { flex: 1, marginLeft: 12 },
  objektHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  objektName: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  simpliBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FFF7ED', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  simpliBadgeText: { fontSize: 10, fontFamily: 'DMSans-SemiBold', color: '#F97316' },
  aiBadge: { width: 24, height: 24, borderRadius: 6, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  objektCity: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },
  objektDetails: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  objektType: { fontSize: 12, fontFamily: 'DMSans-Medium', color: '#9CA3AF' },
  objektRooms: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#9CA3AF' },
  objektFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  objektPrice: { fontSize: 16, fontFamily: 'DMSans-Bold', color: '#111827' },
  objektStats: { flexDirection: 'row', gap: 12 },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { fontSize: 12, fontFamily: 'DMSans-Medium', color: '#6B7280' },
});
