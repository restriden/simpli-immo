import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';
import {
  startGHLOAuth,
  checkGHLConnection,
  disconnectGHL,
  syncGHLData,
  formatLastSync,
  debugGHLConnections,
  registerGHLWebhooks,
  GHLConnection
} from '../../lib/ghl';

export default function ProfilScreen() {
  const router = useRouter();
  const { user, profile, signOut, loading: authLoading } = useAuth();

  // GHL Connection State
  const [ghlConnection, setGhlConnection] = useState<GHLConnection | null>(null);
  const [ghlLoading, setGhlLoading] = useState(false);
  const [ghlConnecting, setGhlConnecting] = useState(false);
  const [ghlSyncing, setGhlSyncing] = useState(false);
  const [ghlRegisteringWebhooks, setGhlRegisteringWebhooks] = useState(false);

  // Load GHL connection status
  const loadGHLStatus = async () => {
    console.log('[PROFIL] loadGHLStatus called, user?.id:', user?.id, 'authLoading:', authLoading);

    if (authLoading) {
      console.log('[PROFIL] Auth still loading, skipping GHL check');
      return;
    }

    if (!user?.id) {
      console.log('[PROFIL] No user.id, not loading GHL');
      setGhlLoading(false);
      return;
    }

    setGhlLoading(true);
    try {
      console.log('[PROFIL] User ID for GHL check:', user.id);
      const connection = await checkGHLConnection(user.id);
      console.log('[PROFIL] GHL connection result:', connection);
      setGhlConnection(connection);
    } catch (error) {
      console.error('[PROFIL] Error loading GHL status:', error);
    } finally {
      console.log('[PROFIL] Setting ghlLoading to false');
      setGhlLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading) {
      loadGHLStatus();
    }
  }, [user?.id, authLoading]);

  // Reload on focus (after OAuth redirect)
  useFocusEffect(
    useCallback(() => {
      if (!authLoading && user?.id) {
        loadGHLStatus();
      }
    }, [user?.id, authLoading])
  );

  // Handle GHL Connect
  const handleGHLConnect = async () => {
    if (!user?.id) {
      Alert.alert('Fehler', 'Du musst eingeloggt sein um GHL zu verbinden.');
      return;
    }

    setGhlConnecting(true);
    try {
      const result = await startGHLOAuth(user.id);

      if (result.success) {
        Alert.alert('Erfolg', 'GoHighLevel wurde erfolgreich verbunden!');
        await loadGHLStatus();
      } else {
        Alert.alert('Fehler', result.error || 'Verbindung fehlgeschlagen');
      }
    } catch (error) {
      console.error('GHL connect error:', error);
      Alert.alert('Fehler', 'Ein unbekannter Fehler ist aufgetreten');
    } finally {
      setGhlConnecting(false);
    }
  };

  // Handle GHL Disconnect
  const handleGHLDisconnect = () => {
    Alert.alert(
      'GHL trennen',
      'Möchtest du die Verbindung zu GoHighLevel wirklich trennen? Deine synchronisierten Daten bleiben erhalten.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Trennen',
          style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;

            const success = await disconnectGHL(user.id);
            if (success) {
              setGhlConnection(null);
              Alert.alert('Erfolg', 'GoHighLevel wurde getrennt.');
            } else {
              Alert.alert('Fehler', 'Trennen fehlgeschlagen');
            }
          },
        },
      ]
    );
  };

  // Handle GHL Sync
  const handleGHLSync = async () => {
    if (!user?.id) return;

    setGhlSyncing(true);
    try {
      const result = await syncGHLData(user.id, 'full');

      if (result.success) {
        const userResult = result.results[user.id];
        Alert.alert(
          'Sync abgeschlossen',
          `Kontakte: ${userResult?.contacts?.synced || 0}\nNachrichten: ${userResult?.conversations?.synced || 0}\nTermine: ${userResult?.appointments?.synced || 0}`
        );
        await loadGHLStatus();
      } else {
        Alert.alert('Fehler', 'Sync fehlgeschlagen');
      }
    } catch (error) {
      console.error('GHL sync error:', error);
      Alert.alert('Fehler', 'Sync fehlgeschlagen');
    } finally {
      setGhlSyncing(false);
    }
  };

  // Handle GHL Webhook Registration
  const handleRegisterWebhooks = async () => {
    if (!user?.id) return;

    setGhlRegisteringWebhooks(true);
    try {
      const result = await registerGHLWebhooks(user.id);

      if (result.success) {
        Alert.alert(
          'Webhooks registriert',
          `${result.webhooksRegistered} Webhooks erfolgreich registriert.\n\nEingehende Nachrichten werden jetzt automatisch synchronisiert.`
        );
      } else {
        Alert.alert(
          'Fehler',
          `Webhook-Registrierung fehlgeschlagen:\n${result.errors.join('\n')}`
        );
      }
    } catch (error) {
      console.error('Webhook registration error:', error);
      Alert.alert('Fehler', 'Webhook-Registrierung fehlgeschlagen');
    } finally {
      setGhlRegisteringWebhooks(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Abmelden', 'Möchtest du dich wirklich abmelden?', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Abmelden', style: 'destructive', onPress: async () => {
        await signOut();
        router.replace('/(auth)/login');
      }},
    ]);
  };

  const initials = profile?.full_name?.split(' ').map(n => n[0]).join('').toUpperCase() || 'MK';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Profil</Text>
        <TouchableOpacity style={styles.settingsButton}>
          <Feather name="settings" size={22} color="#6B7280" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{profile?.full_name || 'Max Köhler'}</Text>
            <Text style={styles.userEmail}>{profile?.email || 'max@example.com'}</Text>
          </View>
          <TouchableOpacity style={styles.editButton}>
            <Feather name="edit-2" size={18} color="#F97316" />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Unternehmen</Text>
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <View style={styles.cardIcon}><Feather name="briefcase" size={18} color="#F97316" /></View>
              <View style={styles.cardContent}>
                <Text style={styles.cardLabel}>Firma</Text>
                <Text style={styles.cardValue}>{profile?.company_name || 'Immobilien Köhler GmbH'}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* GoHighLevel Integration Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Integrationen</Text>

          {ghlLoading ? (
            <View style={styles.ghlCard}>
              <ActivityIndicator size="small" color="#F97316" />
            </View>
          ) : ghlConnection ? (
            // Connected State
            <View style={styles.ghlCard}>
              <View style={styles.ghlHeader}>
                <View style={styles.ghlIconConnected}>
                  <Feather name="link" size={20} color="#22C55E" />
                </View>
                <View style={styles.ghlInfo}>
                  <View style={styles.ghlTitleRow}>
                    <Text style={styles.ghlTitle}>GoHighLevel</Text>
                    <View style={styles.ghlBadgeConnected}>
                      <Feather name="check-circle" size={12} color="#22C55E" />
                      <Text style={styles.ghlBadgeText}>Verbunden</Text>
                    </View>
                  </View>
                  <Text style={styles.ghlLocation}>
                    {ghlConnection.location_name || ghlConnection.location_id}
                  </Text>
                  <Text style={styles.ghlLastSync}>
                    {formatLastSync(ghlConnection.last_sync_at)}
                  </Text>
                </View>
              </View>

              <View style={styles.ghlActions}>
                <TouchableOpacity
                  style={styles.ghlSyncButton}
                  onPress={handleGHLSync}
                  disabled={ghlSyncing}
                >
                  {ghlSyncing ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Feather name="refresh-cw" size={16} color="#FFFFFF" />
                      <Text style={styles.ghlSyncButtonText}>Sync</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.ghlWebhookButton}
                  onPress={handleRegisterWebhooks}
                  disabled={ghlRegisteringWebhooks}
                >
                  {ghlRegisteringWebhooks ? (
                    <ActivityIndicator size="small" color="#3B82F6" />
                  ) : (
                    <>
                      <Feather name="radio" size={16} color="#3B82F6" />
                      <Text style={styles.ghlWebhookButtonText}>Webhooks</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.ghlDisconnectButton}
                  onPress={handleGHLDisconnect}
                >
                  <Feather name="x" size={16} color="#EF4444" />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            // Not Connected State
            <TouchableOpacity
              style={styles.ghlConnectCard}
              onPress={handleGHLConnect}
              disabled={ghlConnecting}
            >
              <View style={styles.ghlConnectContent}>
                <View style={styles.ghlIconDisconnected}>
                  <Feather name="link-2" size={24} color="#6B7280" />
                </View>
                <View style={styles.ghlConnectInfo}>
                  <Text style={styles.ghlConnectTitle}>GoHighLevel verbinden</Text>
                  <Text style={styles.ghlConnectSubtitle}>
                    Synchronisiere Leads, Nachrichten und Termine
                  </Text>
                </View>
              </View>
              {ghlConnecting ? (
                <ActivityIndicator size="small" color="#F97316" />
              ) : (
                <View style={styles.ghlConnectButton}>
                  <Text style={styles.ghlConnectButtonText}>Verbinden</Text>
                  <Feather name="arrow-right" size={16} color="#FFFFFF" />
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>KI-Assistent</Text>
          <TouchableOpacity style={styles.kiCard}>
            <View style={styles.kiHeader}>
              <View style={styles.kiIconContainer}>
                <Feather name="cpu" size={24} color="#FFFFFF" />
              </View>
              <View style={styles.kiContent}>
                <Text style={styles.kiTitle}>KI-Wissensdatenbank</Text>
                <Text style={styles.kiSubtitle}>18 Fakten gespeichert</Text>
              </View>
              <Feather name="chevron-right" size={20} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Einstellungen</Text>
          <View style={styles.menuCard}>
            {[
              { icon: 'bell', label: 'Benachrichtigungen' },
              { icon: 'shield', label: 'Datenschutz' },
              { icon: 'help-circle', label: 'Hilfe & Support' },
              { icon: 'info', label: 'Über simpli.immo' },
            ].map((item, index) => (
              <React.Fragment key={item.label}>
                <TouchableOpacity style={styles.menuItem}>
                  <View style={styles.menuIcon}><Feather name={item.icon as any} size={18} color="#6B7280" /></View>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  <Feather name="chevron-right" size={18} color="#D1D5DB" />
                </TouchableOpacity>
                {index < 3 && <View style={styles.menuDivider} />}
              </React.Fragment>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Feather name="log-out" size={20} color="#EF4444" />
          <Text style={styles.signOutText}>Abmelden</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onLongPress={async () => {
            if (user?.id) {
              const debugInfo = await debugGHLConnections(user.id);
              Alert.alert(
                'Debug Info',
                `User ID: ${user.id}\n\nGHL Connections: ${debugInfo.allConnections.length}\n\nActive: ${debugInfo.activeConnection ? 'Yes' : 'No'}\n\nError: ${debugInfo.error || 'None'}`
              );
            } else {
              Alert.alert('Debug Info', 'No user logged in');
            }
          }}
        >
          <Text style={styles.version}>Version 1.0.0</Text>
        </TouchableOpacity>
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 28, fontFamily: 'DMSans-Bold', color: '#111827' },
  settingsButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#F9FAFB', justifyContent: 'center', alignItems: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  userCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: '#F3F4F6' },
  avatar: { width: 60, height: 60, borderRadius: 16, backgroundColor: '#F97316', justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 22, fontFamily: 'DMSans-Bold', color: '#FFFFFF' },
  userInfo: { flex: 1, marginLeft: 14 },
  userName: { fontSize: 18, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  userEmail: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },
  editButton: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#6B7280', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 4, borderWidth: 1, borderColor: '#F3F4F6' },
  cardRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  cardIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  cardContent: { flex: 1, marginLeft: 12 },
  cardLabel: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#9CA3AF' },
  cardValue: { fontSize: 15, fontFamily: 'DMSans-Medium', color: '#111827', marginTop: 1 },
  kiCard: { backgroundColor: '#F97316', borderRadius: 16, padding: 16 },
  kiHeader: { flexDirection: 'row', alignItems: 'center' },
  kiIconContainer: { width: 48, height: 48, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  kiContent: { flex: 1, marginLeft: 12 },
  kiTitle: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#FFFFFF' },
  kiSubtitle: { fontSize: 13, fontFamily: 'DMSans-Regular', color: 'rgba(255,255,255,0.8)', marginTop: 1 },
  menuCard: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#F3F4F6' },
  menuItem: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  menuIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F9FAFB', justifyContent: 'center', alignItems: 'center' },
  menuLabel: { flex: 1, fontSize: 15, fontFamily: 'DMSans-Medium', color: '#111827', marginLeft: 12 },
  menuDivider: { height: 1, backgroundColor: '#F3F4F6', marginLeft: 64 },
  signOutButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, marginTop: 8 },
  signOutText: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#EF4444' },
  version: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#9CA3AF', textAlign: 'center', marginTop: 8 },

  // GHL Styles
  ghlCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#D1FAE5' },
  ghlHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  ghlIconConnected: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#D1FAE5', justifyContent: 'center', alignItems: 'center' },
  ghlInfo: { flex: 1, marginLeft: 12 },
  ghlTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ghlTitle: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  ghlBadgeConnected: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#D1FAE5', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  ghlBadgeText: { fontSize: 11, fontFamily: 'DMSans-SemiBold', color: '#22C55E' },
  ghlLocation: { fontSize: 14, fontFamily: 'DMSans-Medium', color: '#6B7280', marginTop: 4 },
  ghlLastSync: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#9CA3AF', marginTop: 2 },
  ghlActions: { flexDirection: 'row', gap: 10, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  ghlSyncButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F97316', paddingVertical: 10, borderRadius: 10 },
  ghlSyncButtonText: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#FFFFFF' },
  ghlWebhookButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#DBEAFE', paddingVertical: 10, borderRadius: 10 },
  ghlWebhookButtonText: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#3B82F6' },
  ghlDisconnectButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEE2E2', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  ghlDisconnectButtonText: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#EF4444' },

  ghlConnectCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#F3F4F6' },
  ghlConnectContent: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  ghlIconDisconnected: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  ghlConnectInfo: { flex: 1, marginLeft: 12 },
  ghlConnectTitle: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  ghlConnectSubtitle: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },
  ghlConnectButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#F97316', paddingVertical: 12, borderRadius: 10 },
  ghlConnectButtonText: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#FFFFFF' },
});
