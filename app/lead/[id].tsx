import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

interface LeadDetails {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  ghl_contact_id: string | null;
  auto_respond_enabled: boolean;
  objekt?: {
    id: string;
    name: string;
  };
}

interface Todo {
  id: string;
  title: string;
  subtitle: string | null;
  type: string;
  priority: string;
  completed: boolean;
  due_date: string | null;
}

const statusLabels: Record<string, { label: string; color: string; bg: string }> = {
  neu: { label: 'Neu', color: '#3B82F6', bg: '#DBEAFE' },
  kontaktiert: { label: 'Kontaktiert', color: '#6B7280', bg: '#F3F4F6' },
  simpli_gesendet: { label: 'Simpli gesendet', color: '#F97316', bg: '#FFF7ED' },
  simpli_bestaetigt: { label: 'Finanziert', color: '#22C55E', bg: '#D1FAE5' },
  extern_finanziert: { label: 'Extern finanziert', color: '#8B5CF6', bg: '#EDE9FE' },
  besichtigt: { label: 'Besichtigt', color: '#3B82F6', bg: '#DBEAFE' },
  abgesagt: { label: 'Abgesagt', color: '#EF4444', bg: '#FEE2E2' },
  gekauft: { label: 'Käufer', color: '#22C55E', bg: '#D1FAE5' },
};

const financingStatus = {
  not_started: { label: 'Nicht gestartet', color: '#6B7280', icon: 'clock' },
  in_progress: { label: 'In Bearbeitung', color: '#F97316', icon: 'loader' },
  approved: { label: 'Genehmigt', color: '#22C55E', icon: 'check-circle' },
  rejected: { label: 'Abgelehnt', color: '#EF4444', icon: 'x-circle' },
};

export default function LeadProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetails | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRespondEnabled, setAutoRespondEnabled] = useState(false);
  const [togglingAutoRespond, setTogglingAutoRespond] = useState(false);

  useEffect(() => {
    loadLeadData();
  }, [id, user?.id]);

  useEffect(() => {
    if (lead) {
      setAutoRespondEnabled(lead.auto_respond_enabled || false);
    }
  }, [lead]);

  const loadLeadData = async () => {
    if (!id || !user?.id) return;

    try {
      // Load lead details
      const { data: leadData, error: leadError } = await supabase
        .from('leads')
        .select(`
          *,
          objekt:objekte(id, name)
        `)
        .eq('id', id)
        .single();

      if (leadError) throw leadError;
      setLead(leadData);

      // Load todos for this lead
      const { data: todosData, error: todosError } = await supabase
        .from('todos')
        .select('*')
        .eq('lead_id', id)
        .order('created_at', { ascending: false });

      if (!todosError && todosData) {
        setTodos(todosData);
      }
    } catch (error) {
      console.error('Error loading lead:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCall = () => {
    if (!lead?.phone) {
      Alert.alert('Keine Telefonnummer', 'Für diesen Kontakt ist keine Telefonnummer hinterlegt.');
      return;
    }
    Linking.openURL(`tel:${lead.phone}`);
  };

  const handleEmail = () => {
    if (!lead?.email) {
      Alert.alert('Keine E-Mail', 'Für diesen Kontakt ist keine E-Mail hinterlegt.');
      return;
    }
    Linking.openURL(`mailto:${lead.email}`);
  };

  const toggleAutoRespond = async (value: boolean) => {
    if (!id || togglingAutoRespond) return;

    setTogglingAutoRespond(true);
    setAutoRespondEnabled(value); // Optimistic update

    try {
      const { error } = await supabase
        .from('leads')
        .update({ auto_respond_enabled: value })
        .eq('id', id);

      if (error) {
        throw error;
      }

      if (value) {
        Alert.alert(
          'KI-Antworten aktiviert',
          'Die KI wird jetzt automatisch auf Fragen dieses Kontakts antworten, wenn sie die Antwort kennt.'
        );
      }
    } catch (error) {
      console.error('Error toggling auto-respond:', error);
      setAutoRespondEnabled(!value); // Revert on error
      Alert.alert('Fehler', 'Einstellung konnte nicht gespeichert werden.');
    } finally {
      setTogglingAutoRespond(false);
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

  if (!lead) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Feather name="arrow-left" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Lead nicht gefunden</Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>
    );
  }

  const status = statusLabels[lead.status] || statusLabels.neu;
  const financing = financingStatus.not_started; // Placeholder - will be dynamic later

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Kontakt</Text>
        <TouchableOpacity onPress={() => router.push(`/chat/${lead.id}`)} style={styles.chatButton}>
          <Feather name="message-circle" size={20} color="#F97316" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {lead.name.split(' ').map(n => n[0]).join('').toUpperCase()}
            </Text>
          </View>
          <Text style={styles.name}>{lead.name}</Text>
          <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
            <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
          </View>
          {lead.source === 'simpli' && (
            <View style={styles.simpliBadge}>
              <Feather name="zap" size={12} color="#F97316" />
              <Text style={styles.simpliText}>Simpli Lead</Text>
            </View>
          )}
        </View>

        {/* Quick Actions */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity style={styles.actionButton} onPress={handleCall}>
            <View style={[styles.actionIcon, { backgroundColor: '#D1FAE5' }]}>
              <Feather name="phone" size={20} color="#22C55E" />
            </View>
            <Text style={styles.actionLabel}>Anrufen</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={handleEmail}>
            <View style={[styles.actionIcon, { backgroundColor: '#DBEAFE' }]}>
              <Feather name="mail" size={20} color="#3B82F6" />
            </View>
            <Text style={styles.actionLabel}>E-Mail</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={() => router.push(`/chat/${lead.id}`)}>
            <View style={[styles.actionIcon, { backgroundColor: '#FFF7ED' }]}>
              <Feather name="send" size={20} color="#F97316" />
            </View>
            <Text style={styles.actionLabel}>Chat</Text>
          </TouchableOpacity>
        </View>

        {/* Contact Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Kontaktdaten</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Feather name="phone" size={18} color="#6B7280" />
              <Text style={styles.infoLabel}>Telefon</Text>
              <Text style={styles.infoValue}>{lead.phone || '–'}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Feather name="mail" size={18} color="#6B7280" />
              <Text style={styles.infoLabel}>E-Mail</Text>
              <Text style={styles.infoValue} numberOfLines={1}>{lead.email || '–'}</Text>
            </View>
            {lead.objekt && (
              <>
                <View style={styles.infoDivider} />
                <View style={styles.infoRow}>
                  <Feather name="home" size={18} color="#6B7280" />
                  <Text style={styles.infoLabel}>Objekt</Text>
                  <Text style={styles.infoValue}>{lead.objekt.name}</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* Financing Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Finanzierung</Text>
          <View style={styles.financingCard}>
            <View style={[styles.financingIcon, { backgroundColor: `${financing.color}20` }]}>
              <Feather name={financing.icon as any} size={24} color={financing.color} />
            </View>
            <View style={styles.financingContent}>
              <Text style={styles.financingStatus}>{financing.label}</Text>
              <Text style={styles.financingNote}>Finanzierungsdaten werden bald verfügbar sein</Text>
            </View>
            <Feather name="chevron-right" size={20} color="#D1D5DB" />
          </View>
        </View>

        {/* KI Auto-Response */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>KI-Assistent</Text>
          <View style={styles.autoRespondCard}>
            <View style={styles.autoRespondInfo}>
              <View style={[styles.autoRespondIcon, autoRespondEnabled && styles.autoRespondIconActive]}>
                <Feather name="cpu" size={20} color={autoRespondEnabled ? '#FFFFFF' : '#6B7280'} />
              </View>
              <View style={styles.autoRespondContent}>
                <Text style={styles.autoRespondTitle}>Auto-Antworten</Text>
                <Text style={styles.autoRespondDesc}>
                  {autoRespondEnabled
                    ? 'KI antwortet automatisch auf Fragen'
                    : 'KI analysiert nur, antwortet nicht'}
                </Text>
              </View>
            </View>
            <Switch
              value={autoRespondEnabled}
              onValueChange={toggleAutoRespond}
              disabled={togglingAutoRespond}
              trackColor={{ false: '#E5E7EB', true: '#86EFAC' }}
              thumbColor={autoRespondEnabled ? '#22C55E' : '#9CA3AF'}
            />
          </View>
          {autoRespondEnabled && (
            <View style={styles.autoRespondWarning}>
              <Feather name="info" size={14} color="#F97316" />
              <Text style={styles.autoRespondWarningText}>
                Die KI nutzt nur Wissen vom zugeordneten Objekt und beantwortet Fragen sofort.
              </Text>
            </View>
          )}
        </View>

        {/* Tasks */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Aufgaben</Text>
            <Text style={styles.sectionCount}>{todos.filter(t => !t.completed).length} offen</Text>
          </View>

          {todos.length === 0 ? (
            <View style={styles.emptyTasks}>
              <Feather name="check-circle" size={24} color="#D1D5DB" />
              <Text style={styles.emptyTasksText}>Keine Aufgaben</Text>
            </View>
          ) : (
            todos.slice(0, 5).map(todo => (
              <View key={todo.id} style={[styles.taskCard, todo.completed && styles.taskCompleted]}>
                <View style={[
                  styles.taskIndicator,
                  { backgroundColor: todo.completed ? '#22C55E' : todo.priority === 'dringend' ? '#EF4444' : '#F97316' }
                ]} />
                <View style={styles.taskContent}>
                  <Text style={[styles.taskTitle, todo.completed && styles.taskTitleCompleted]}>
                    {todo.title}
                  </Text>
                  {todo.subtitle && (
                    <Text style={styles.taskSubtitle} numberOfLines={1}>{todo.subtitle}</Text>
                  )}
                </View>
                {todo.completed && <Feather name="check" size={16} color="#22C55E" />}
              </View>
            ))
          )}
        </View>

        {/* Notes */}
        {lead.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notizen</Text>
            <View style={styles.notesCard}>
              <Text style={styles.notesText}>{lead.notes}</Text>
            </View>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  chatButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: { flex: 1 },
  profileCard: {
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: { fontSize: 28, fontFamily: 'DMSans-Bold', color: '#6B7280' },
  name: { fontSize: 24, fontFamily: 'DMSans-Bold', color: '#111827', marginBottom: 8 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  statusText: { fontSize: 13, fontFamily: 'DMSans-SemiBold' },
  simpliBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#FFF7ED',
    borderRadius: 6,
  },
  simpliText: { fontSize: 12, fontFamily: 'DMSans-Medium', color: '#F97316' },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  actionButton: { alignItems: 'center', gap: 6 },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLabel: { fontSize: 12, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  section: { marginTop: 16, paddingHorizontal: 20 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 12 },
  sectionCount: {
    fontSize: 13,
    fontFamily: 'DMSans-Medium',
    color: '#6B7280',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  infoLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'DMSans-Regular',
    color: '#6B7280',
    marginLeft: 12,
  },
  infoValue: {
    fontSize: 14,
    fontFamily: 'DMSans-Medium',
    color: '#111827',
    maxWidth: '50%',
  },
  infoDivider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 4 },
  financingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
  },
  financingIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  financingContent: { flex: 1, marginLeft: 12 },
  financingStatus: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  financingNote: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },
  emptyTasks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
  },
  emptyTasksText: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#9CA3AF' },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  taskCompleted: { opacity: 0.6 },
  taskIndicator: { width: 4, height: '100%', borderRadius: 2, marginRight: 12 },
  taskContent: { flex: 1 },
  taskTitle: { fontSize: 14, fontFamily: 'DMSans-Medium', color: '#111827' },
  taskTitleCompleted: { textDecorationLine: 'line-through', color: '#9CA3AF' },
  taskSubtitle: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },
  notesCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
  },
  notesText: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#374151', lineHeight: 20 },
  // Auto-Respond
  autoRespondCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
  },
  autoRespondInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  autoRespondIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  autoRespondIconActive: {
    backgroundColor: '#22C55E',
  },
  autoRespondContent: {
    flex: 1,
    marginLeft: 12,
    marginRight: 12,
  },
  autoRespondTitle: {
    fontSize: 15,
    fontFamily: 'DMSans-SemiBold',
    color: '#111827',
  },
  autoRespondDesc: {
    fontSize: 13,
    fontFamily: 'DMSans-Regular',
    color: '#6B7280',
    marginTop: 2,
  },
  autoRespondWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFF7ED',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  autoRespondWarningText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'DMSans-Regular',
    color: '#9A3412',
    lineHeight: 18,
  },
});
