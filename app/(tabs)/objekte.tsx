import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';
import { getObjekte, Objekt } from '../../lib/database';

export default function ObjekteScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<'alle' | 'aktiv' | 'verkauft'>('alle');
  const [objekte, setObjekte] = useState<Objekt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
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
              Lade ein Exposé hoch oder erstelle ein Objekt manuell.
            </Text>
            <TouchableOpacity 
              style={styles.emptyButton}
              onPress={() => router.push('/magic-upload')}
            >
              <Feather name="upload" size={18} color="#FFFFFF" />
              <Text style={styles.emptyButtonText}>Exposé hochladen</Text>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
});
