import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  RefreshControl,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import {
  isAdmin,
  getApprovedSubaccounts,
  getActiveConnections,
  getAdminStats,
  addApprovedSubaccount,
  updateApprovedSubaccount,
  removeApprovedSubaccount,
  toggleSubaccountStatus,
  disconnectConnection,
  ApprovedSubaccount,
  ActiveConnection,
  AdminStats,
} from '../lib/admin';

type TabType = 'whitelist' | 'connections' | 'stats';

export default function AdminScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [isAdminUser, setIsAdminUser] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('whitelist');

  // Data
  const [subaccounts, setSubaccounts] = useState<ApprovedSubaccount[]>([]);
  const [connections, setConnections] = useState<ActiveConnection[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);

  // Add Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newSubaccount, setNewSubaccount] = useState({
    location_id: '',
    location_name: '',
    company_name: '',
    contact_email: '',
    notes: '',
  });

  useEffect(() => {
    checkAdminAccess();
  }, [user?.id]);

  const checkAdminAccess = async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    const adminStatus = await isAdmin(user.id);
    setIsAdminUser(adminStatus);

    if (adminStatus) {
      await loadData();
    }
    setLoading(false);
  };

  const loadData = async () => {
    const [subaccountsData, connectionsData, statsData] = await Promise.all([
      getApprovedSubaccounts(),
      getActiveConnections(),
      getAdminStats(),
    ]);

    setSubaccounts(subaccountsData);
    setConnections(connectionsData);
    setStats(statsData);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, []);

  const handleAddSubaccount = async () => {
    if (!newSubaccount.location_id.trim()) {
      Alert.alert('Fehler', 'Location ID ist erforderlich');
      return;
    }

    setAdding(true);
    const result = await addApprovedSubaccount(newSubaccount);

    if (result.success) {
      Alert.alert('Erfolg', 'Subaccount wurde zur Whitelist hinzugefügt');
      setShowAddModal(false);
      setNewSubaccount({
        location_id: '',
        location_name: '',
        company_name: '',
        contact_email: '',
        notes: '',
      });
      await loadData();
    } else {
      Alert.alert('Fehler', result.error || 'Konnte nicht hinzufügen');
    }
    setAdding(false);
  };

  const handleToggleStatus = async (subaccount: ApprovedSubaccount) => {
    const result = await toggleSubaccountStatus(subaccount.id, !subaccount.is_active);
    if (result.success) {
      await loadData();
    } else {
      Alert.alert('Fehler', result.error || 'Status konnte nicht geändert werden');
    }
  };

  const handleRemoveSubaccount = (subaccount: ApprovedSubaccount) => {
    Alert.alert(
      'Subaccount entfernen',
      `"${subaccount.location_name || subaccount.location_id}" wirklich aus der Whitelist entfernen?`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: async () => {
            const result = await removeApprovedSubaccount(subaccount.id);
            if (result.success) {
              await loadData();
            } else {
              Alert.alert('Fehler', result.error || 'Konnte nicht entfernen');
            }
          },
        },
      ]
    );
  };

  const handleDisconnect = (connection: ActiveConnection) => {
    Alert.alert(
      'Verbindung trennen',
      `Verbindung zu "${connection.location_name || connection.location_id}" trennen?`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Trennen',
          style: 'destructive',
          onPress: async () => {
            const result = await disconnectConnection(connection.id);
            if (result.success) {
              await loadData();
            } else {
              Alert.alert('Fehler', result.error || 'Konnte nicht trennen');
            }
          },
        },
      ]
    );
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

  if (!isAdminUser) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Feather name="arrow-left" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Admin</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.accessDenied}>
          <Feather name="shield-off" size={64} color="#EF4444" />
          <Text style={styles.accessDeniedTitle}>Kein Zugriff</Text>
          <Text style={styles.accessDeniedText}>
            Du hast keine Admin-Berechtigung.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Admin Dashboard</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setShowAddModal(true)}
        >
          <Feather name="plus" size={24} color="#F97316" />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'whitelist' && styles.tabActive]}
          onPress={() => setActiveTab('whitelist')}
        >
          <Feather
            name="list"
            size={18}
            color={activeTab === 'whitelist' ? '#F97316' : '#6B7280'}
          />
          <Text style={[styles.tabText, activeTab === 'whitelist' && styles.tabTextActive]}>
            Whitelist
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'connections' && styles.tabActive]}
          onPress={() => setActiveTab('connections')}
        >
          <Feather
            name="link"
            size={18}
            color={activeTab === 'connections' ? '#F97316' : '#6B7280'}
          />
          <Text style={[styles.tabText, activeTab === 'connections' && styles.tabTextActive]}>
            Verbindungen
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'stats' && styles.tabActive]}
          onPress={() => setActiveTab('stats')}
        >
          <Feather
            name="bar-chart-2"
            size={18}
            color={activeTab === 'stats' ? '#F97316' : '#6B7280'}
          />
          <Text style={[styles.tabText, activeTab === 'stats' && styles.tabTextActive]}>
            Stats
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Whitelist Tab */}
        {activeTab === 'whitelist' && (
          <>
            <Text style={styles.sectionTitle}>
              Freigegebene Subaccounts ({subaccounts.length})
            </Text>

            {subaccounts.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="shield" size={48} color="#D1D5DB" />
                <Text style={styles.emptyTitle}>Keine Subaccounts</Text>
                <Text style={styles.emptyText}>
                  Füge Subaccounts zur Whitelist hinzu, um Verbindungen zu erlauben.
                </Text>
              </View>
            ) : (
              subaccounts.map((sub) => (
                <View
                  key={sub.id}
                  style={[styles.card, !sub.is_active && styles.cardInactive]}
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.cardIcon}>
                      <Feather
                        name="server"
                        size={20}
                        color={sub.is_active ? '#22C55E' : '#9CA3AF'}
                      />
                    </View>
                    <View style={styles.cardContent}>
                      <Text style={styles.cardTitle}>
                        {sub.location_name || sub.location_id}
                      </Text>
                      {sub.company_name && (
                        <Text style={styles.cardSubtitle}>{sub.company_name}</Text>
                      )}
                      <Text style={styles.cardMeta}>
                        ID: {sub.location_id.substring(0, 12)}...
                      </Text>
                    </View>
                    <Switch
                      value={sub.is_active}
                      onValueChange={() => handleToggleStatus(sub)}
                      trackColor={{ false: '#E5E7EB', true: '#D1FAE5' }}
                      thumbColor={sub.is_active ? '#22C55E' : '#9CA3AF'}
                    />
                  </View>
                  <View style={styles.cardActions}>
                    {sub.contact_email && (
                      <Text style={styles.cardEmail}>
                        <Feather name="mail" size={12} /> {sub.contact_email}
                      </Text>
                    )}
                    <TouchableOpacity
                      style={styles.removeButton}
                      onPress={() => handleRemoveSubaccount(sub)}
                    >
                      <Feather name="trash-2" size={16} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </>
        )}

        {/* Connections Tab */}
        {activeTab === 'connections' && (
          <>
            <Text style={styles.sectionTitle}>
              Aktive Verbindungen ({connections.filter(c => c.is_active).length})
            </Text>

            {connections.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="link-2" size={48} color="#D1D5DB" />
                <Text style={styles.emptyTitle}>Keine Verbindungen</Text>
                <Text style={styles.emptyText}>
                  Noch keine Subaccounts verbunden.
                </Text>
              </View>
            ) : (
              connections.map((conn) => (
                <View
                  key={conn.id}
                  style={[styles.card, !conn.is_active && styles.cardInactive]}
                >
                  <View style={styles.cardHeader}>
                    <View
                      style={[
                        styles.cardIcon,
                        { backgroundColor: conn.is_active ? '#D1FAE5' : '#F3F4F6' },
                      ]}
                    >
                      <Feather
                        name="link"
                        size={20}
                        color={conn.is_active ? '#22C55E' : '#9CA3AF'}
                      />
                    </View>
                    <View style={styles.cardContent}>
                      <Text style={styles.cardTitle}>
                        {conn.location_name || conn.location_id}
                      </Text>
                      <Text style={styles.cardMeta}>
                        Verbunden: {new Date(conn.created_at).toLocaleDateString('de-DE')}
                      </Text>
                      {conn.last_sync_at && (
                        <Text style={styles.cardMeta}>
                          Letzter Sync: {new Date(conn.last_sync_at).toLocaleString('de-DE')}
                        </Text>
                      )}
                    </View>
                    {conn.is_active && (
                      <TouchableOpacity
                        style={styles.disconnectButton}
                        onPress={() => handleDisconnect(conn)}
                      >
                        <Feather name="x" size={18} color="#EF4444" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))
            )}
          </>
        )}

        {/* Stats Tab */}
        {activeTab === 'stats' && stats && (
          <>
            <Text style={styles.sectionTitle}>Statistiken</Text>

            <View style={styles.statsGrid}>
              <View style={[styles.statCard, { backgroundColor: '#FFF7ED' }]}>
                <Feather name="shield" size={24} color="#F97316" />
                <Text style={styles.statValue}>{stats.total_approved}</Text>
                <Text style={styles.statLabel}>Whitelist</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: '#D1FAE5' }]}>
                <Feather name="link" size={24} color="#22C55E" />
                <Text style={styles.statValue}>{stats.active_connections}</Text>
                <Text style={styles.statLabel}>Verbunden</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: '#DBEAFE' }]}>
                <Feather name="users" size={24} color="#3B82F6" />
                <Text style={styles.statValue}>{stats.total_leads}</Text>
                <Text style={styles.statLabel}>Leads</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: '#EDE9FE' }]}>
                <Feather name="message-circle" size={24} color="#8B5CF6" />
                <Text style={styles.statValue}>{stats.total_messages}</Text>
                <Text style={styles.statLabel}>Nachrichten</Text>
              </View>
            </View>
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Add Modal */}
      <Modal visible={showAddModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Subaccount hinzufügen</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Feather name="x" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Location ID *</Text>
                <TextInput
                  style={styles.textInput}
                  value={newSubaccount.location_id}
                  onChangeText={(t) => setNewSubaccount({ ...newSubaccount, location_id: t })}
                  placeholder="z.B. tiC9FckRBUxhbaleTYma"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Location Name</Text>
                <TextInput
                  style={styles.textInput}
                  value={newSubaccount.location_name}
                  onChangeText={(t) => setNewSubaccount({ ...newSubaccount, location_name: t })}
                  placeholder="z.B. Immobilien Müller"
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Firmenname</Text>
                <TextInput
                  style={styles.textInput}
                  value={newSubaccount.company_name}
                  onChangeText={(t) => setNewSubaccount({ ...newSubaccount, company_name: t })}
                  placeholder="z.B. Müller Immobilien GmbH"
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Kontakt E-Mail</Text>
                <TextInput
                  style={styles.textInput}
                  value={newSubaccount.contact_email}
                  onChangeText={(t) => setNewSubaccount({ ...newSubaccount, contact_email: t })}
                  placeholder="kontakt@example.com"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Notizen</Text>
                <TextInput
                  style={[styles.textInput, { height: 80 }]}
                  value={newSubaccount.notes}
                  onChangeText={(t) => setNewSubaccount({ ...newSubaccount, notes: t })}
                  placeholder="Optionale Notizen..."
                  placeholderTextColor="#9CA3AF"
                  multiline
                />
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowAddModal(false)}
              >
                <Text style={styles.cancelButtonText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitButton, adding && styles.submitButtonDisabled]}
                onPress={handleAddSubaccount}
                disabled={adding}
              >
                {adding ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitButtonText}>Hinzufügen</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  accessDenied: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  accessDeniedTitle: { fontSize: 20, fontFamily: 'DMSans-Bold', color: '#111827', marginTop: 16 },
  accessDeniedText: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 8, textAlign: 'center' },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  tabActive: { backgroundColor: '#FFF7ED' },
  tabText: { fontSize: 13, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  tabTextActive: { color: '#F97316' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16 },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'DMSans-SemiBold',
    color: '#6B7280',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyTitle: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#111827', marginTop: 12 },
  emptyText: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 4, textAlign: 'center' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardInactive: { opacity: 0.6, backgroundColor: '#F9FAFB' },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#D1FAE5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardContent: { flex: 1, marginLeft: 12 },
  cardTitle: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  cardSubtitle: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },
  cardMeta: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#9CA3AF', marginTop: 2 },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  cardEmail: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#6B7280' },
  removeButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  disconnectButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    width: '47%',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statValue: { fontSize: 28, fontFamily: 'DMSans-Bold', color: '#111827', marginTop: 8 },
  statLabel: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 4 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  modalTitle: { fontSize: 18, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  modalScroll: { padding: 20 },
  inputGroup: { marginBottom: 16 },
  inputLabel: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 8 },
  textInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: 'DMSans-Regular',
    color: '#111827',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  cancelButtonText: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#6B7280' },
  submitButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#F97316',
    alignItems: 'center',
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#FFFFFF' },
});
