import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';
import { getTodos, getDashboardStats, Todo } from '../../lib/database';
import { completeGHLTask, subscribeToTodos, createGHLTask, syncGHLData } from '../../lib/ghl';

const todoIcons: Record<string, { icon: string; color: string }> = {
  nachricht: { icon: 'message-circle', color: '#EF4444' },
  anruf: { icon: 'phone', color: '#22C55E' },
  besichtigung: { icon: 'calendar', color: '#3B82F6' },
  finanzierung: { icon: 'credit-card', color: '#F97316' },
  dokument: { icon: 'file-text', color: '#8B5CF6' },
};

export default function HomeScreen() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [completedTodos, setCompletedTodos] = useState<string[]>([]);
  const [stats, setStats] = useState({
    openTodos: 0,
    activeObjekte: 0,
    monthlyProvision: 0,
  });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskType, setNewTaskType] = useState('nachricht');
  const [newTaskPriority, setNewTaskPriority] = useState('normal');
  const [creating, setCreating] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const firstName = profile?.full_name?.split(' ')[0] || 'Makler';

  const handleCreateTask = async () => {
    if (!user?.id || !newTaskTitle.trim()) {
      Alert.alert('Fehler', 'Bitte gib einen Titel ein');
      return;
    }

    setCreating(true);
    try {
      const result = await createGHLTask(user.id, {
        title: newTaskTitle.trim(),
        description: newTaskDescription.trim() || undefined,
        type: newTaskType,
        priority: newTaskPriority,
      });

      if (result.success) {
        setShowCreateModal(false);
        setNewTaskTitle('');
        setNewTaskDescription('');
        setNewTaskType('nachricht');
        setNewTaskPriority('normal');
        // Reload data to show new task
        loadData();
      } else {
        Alert.alert('Fehler', result.error || 'Konnte Aufgabe nicht erstellen');
      }
    } catch (error) {
      Alert.alert('Fehler', 'Konnte Aufgabe nicht erstellen');
    } finally {
      setCreating(false);
    }
  };

  const loadData = async () => {
    console.log('[DEBUG] loadData called - user:', user, 'user?.id:', user?.id);

    if (!user?.id) {
      console.log('[DEBUG] loadData: No user.id, returning early');
      setLoading(false);  // FIX: Set loading to false even when no user
      return;
    }

    console.log('[DEBUG] loadData: Fetching data for user.id:', user.id);

    try {
      const [todosData, statsData] = await Promise.all([
        getTodos(user.id),
        getDashboardStats(user.id),
      ]);

      console.log('[DEBUG] loadData: Received todosData:', todosData, 'statsData:', statsData);

      setTodos(todosData);
      setStats(statsData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user?.id]);

  // Realtime subscription for todos
  useEffect(() => {
    if (!user?.id) return;

    console.log('[DASHBOARD] Setting up realtime subscription for todos');
    const unsubscribe = subscribeToTodos(user.id, (todo, eventType) => {
      console.log('[DASHBOARD] Todo event:', eventType, todo?.id);

      if (eventType === 'INSERT') {
        setTodos(prev => {
          // Avoid duplicates
          if (prev.some(t => t.id === todo.id)) return prev;
          // Add new todo if not completed
          if (!todo.completed) {
            return [todo, ...prev];
          }
          return prev;
        });
        setStats(prev => ({ ...prev, openTodos: prev.openTodos + 1 }));
      } else if (eventType === 'UPDATE') {
        if (todo.completed) {
          // Remove completed todo
          setTodos(prev => prev.filter(t => t.id !== todo.id));
          setStats(prev => ({ ...prev, openTodos: Math.max(0, prev.openTodos - 1) }));
        } else {
          // Update existing todo
          setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, ...todo } : t));
        }
      } else if (eventType === 'DELETE') {
        setTodos(prev => prev.filter(t => t.id !== todo.id));
        setStats(prev => ({ ...prev, openTodos: Math.max(0, prev.openTodos - 1) }));
      }
    });

    return () => {
      console.log('[DASHBOARD] Cleaning up realtime subscription');
      unsubscribe();
    };
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [user?.id])
  );

  const onRefresh = async () => {
    if (!user?.id) return;

    // If already syncing, just show status
    if (isSyncing) {
      setRefreshing(true);
      setRefreshStatus('Lädt noch...');
      setTimeout(() => setRefreshing(false), 1500);
      return;
    }

    setRefreshing(true);
    setIsSyncing(true);
    setRefreshStatus('Prüfe neue Aufgaben & Übersetzungen...');

    // Hide refresh indicator after 3 seconds max
    const hideRefresh = setTimeout(() => {
      setRefreshing(false);
      setRefreshStatus('');
    }, 3000);

    try {
      // Sync tasks from GHL (includes translation) - runs in background if needed
      await syncGHLData(user.id, 'tasks');

      // Reload local data
      await loadData();
    } catch (error) {
      console.error('Refresh error:', error);
    } finally {
      clearTimeout(hideRefresh);
      setRefreshStatus('');
      setRefreshing(false);
      setIsSyncing(false);
    }
  };

  const toggleTodo = async (todoId: string) => {
    if (!user?.id) return;

    if (completedTodos.includes(todoId)) {
      setCompletedTodos(prev => prev.filter(id => id !== todoId));
    } else {
      setCompletedTodos(prev => [...prev, todoId]);

      // Complete after animation delay
      setTimeout(async () => {
        const result = await completeGHLTask(user.id, todoId, true);
        console.log('[DASHBOARD] Complete task result:', result);

        if (result.success) {
          setTodos(prev => prev.filter(t => t.id !== todoId));
          setStats(prev => ({ ...prev, openTodos: Math.max(0, prev.openTodos - 1) }));
        }
        setCompletedTodos(prev => prev.filter(id => id !== todoId));
      }, 1500);
    }
  };

  const dringendeTodos = todos.filter(t => t.priority === 'dringend' && !completedTodos.includes(t.id));
  const normaleTodos = todos.filter(t => t.priority !== 'dringend' && !completedTodos.includes(t.id));

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
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.greeting}>Willkommen zurück,</Text>
            <Text style={styles.userName}>{firstName}</Text>
          </View>
          <TouchableOpacity 
            style={styles.provisionButton}
            onPress={() => router.push('/provision')}
          >
            <Feather name="dollar-sign" size={20} color="#F97316" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#F97316"
            colors={['#F97316']}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {refreshStatus ? (
          <View style={styles.syncBanner}>
            <ActivityIndicator size="small" color="#F97316" />
            <Text style={styles.syncBannerText}>{refreshStatus}</Text>
          </View>
        ) : null}

        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: '#FEF3C7' }]}>
              <Feather name="check-circle" size={20} color="#F59E0B" />
            </View>
            <Text style={styles.statValue}>{stats.openTodos}</Text>
            <Text style={styles.statLabel}>Offene To-Dos</Text>
          </View>
          
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: '#DBEAFE' }]}>
              <Feather name="home" size={20} color="#3B82F6" />
            </View>
            <Text style={styles.statValue}>{stats.activeObjekte}</Text>
            <Text style={styles.statLabel}>Aktive Objekte</Text>
          </View>
          
          <TouchableOpacity 
            style={styles.statCard}
            onPress={() => router.push('/provision')}
          >
            <View style={[styles.statIcon, { backgroundColor: '#D1FAE5' }]}>
              <Feather name="trending-up" size={20} color="#22C55E" />
            </View>
            <Text style={styles.statValue}>€{stats.monthlyProvision.toLocaleString()}</Text>
            <Text style={styles.statLabel}>Provision MTD</Text>
          </TouchableOpacity>
        </View>

        {todos.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Feather name="check-circle" size={48} color="#22C55E" />
            </View>
            <Text style={styles.emptyTitle}>Alles erledigt! 🎉</Text>
            <Text style={styles.emptyText}>Du hast keine offenen Aufgaben.</Text>
          </View>
        )}

        {dringendeTodos.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleContainer}>
                <View style={styles.urgentDot} />
                <Text style={styles.sectionTitle}>Jetzt handeln</Text>
              </View>
              <Text style={styles.sectionCount}>{dringendeTodos.length}</Text>
            </View>
            
            {dringendeTodos.map(todo => (
              <TodoCard
                key={todo.id}
                todo={todo}
                completed={completedTodos.includes(todo.id)}
                onToggle={() => toggleTodo(todo.id)}
                onPress={() => todo.lead_id ? router.push(`/chat/${todo.lead_id}`) : null}
              />
            ))}
          </View>
        )}

        {normaleTodos.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Weitere Aufgaben</Text>
              <Text style={styles.sectionCount}>{normaleTodos.length}</Text>
            </View>
            
            {normaleTodos.map(todo => (
              <TodoCard
                key={todo.id}
                todo={todo}
                completed={completedTodos.includes(todo.id)}
                onToggle={() => toggleTodo(todo.id)}
                onPress={() => todo.lead_id ? router.push(`/chat/${todo.lead_id}`) : null}
              />
            ))}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* FAB Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowCreateModal(true)}
      >
        <Feather name="plus" size={24} color="#FFFFFF" />
      </TouchableOpacity>

      {/* Create Task Modal */}
      <Modal
        visible={showCreateModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCreateModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Neue Aufgabe</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Feather name="x" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.input}
              placeholder="Titel *"
              value={newTaskTitle}
              onChangeText={setNewTaskTitle}
              autoFocus
            />

            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Beschreibung (optional)"
              value={newTaskDescription}
              onChangeText={setNewTaskDescription}
              multiline
              numberOfLines={3}
            />

            <Text style={styles.inputLabel}>Typ</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeSelector}>
              {Object.entries(todoIcons).map(([type, config]) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.typeButton,
                    newTaskType === type && { backgroundColor: config.color },
                  ]}
                  onPress={() => setNewTaskType(type)}
                >
                  <Feather
                    name={config.icon as any}
                    size={16}
                    color={newTaskType === type ? '#FFFFFF' : config.color}
                  />
                  <Text style={[
                    styles.typeButtonText,
                    newTaskType === type && { color: '#FFFFFF' },
                  ]}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.inputLabel}>Priorität</Text>
            <View style={styles.prioritySelector}>
              <TouchableOpacity
                style={[
                  styles.priorityButton,
                  newTaskPriority === 'normal' && styles.priorityButtonActive,
                ]}
                onPress={() => setNewTaskPriority('normal')}
              >
                <Text style={[
                  styles.priorityButtonText,
                  newTaskPriority === 'normal' && styles.priorityButtonTextActive,
                ]}>Normal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.priorityButton,
                  newTaskPriority === 'dringend' && styles.priorityButtonUrgent,
                ]}
                onPress={() => setNewTaskPriority('dringend')}
              >
                <Text style={[
                  styles.priorityButtonText,
                  newTaskPriority === 'dringend' && { color: '#FFFFFF' },
                ]}>Dringend</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.createButton, creating && styles.createButtonDisabled]}
              onPress={handleCreateTask}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.createButtonText}>Aufgabe erstellen</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function TodoCard({
  todo,
  completed,
  onToggle,
  onPress,
}: {
  todo: Todo;
  completed: boolean;
  onToggle: () => void;
  onPress: () => void;
}) {
  const iconConfig = todoIcons[todo.type] || todoIcons.sonstiges;
  
  return (
    <TouchableOpacity
      style={[styles.todoCard, completed && styles.todoCardCompleted]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <TouchableOpacity
        style={[styles.checkbox, completed && styles.checkboxCompleted]}
        onPress={onToggle}
      >
        {completed && <Feather name="check" size={14} color="#FFFFFF" />}
      </TouchableOpacity>
      
      <View style={styles.todoContent}>
        <View style={styles.todoHeader}>
          <View style={[styles.todoIcon, { backgroundColor: `${iconConfig.color}15` }]}>
            <Feather name={iconConfig.icon as any} size={16} color={iconConfig.color} />
          </View>
          <Text style={[styles.todoTitle, completed && styles.todoTitleCompleted]}>
            {todo.title}
          </Text>
        </View>
        {todo.subtitle && (
          <Text style={styles.todoSubtitle}>{todo.subtitle}</Text>
        )}
        <View style={styles.todoFooter}>
          {todo.lead?.name && (
            <>
              <Text style={styles.todoContact}>{todo.lead.name}</Text>
              <Text style={styles.todoSeparator}>•</Text>
            </>
          )}
          {todo.objekt?.name && (
            <Text style={styles.todoObjekt}>{todo.objekt.name}</Text>
          )}
        </View>
      </View>
      
      <Feather name="chevron-right" size={20} color="#D1D5DB" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#F97316', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  greeting: { fontSize: 14, fontFamily: 'DMSans-Regular', color: 'rgba(255,255,255,0.8)' },
  userName: { fontSize: 24, fontFamily: 'DMSans-Bold', color: '#FFFFFF' },
  provisionButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20 },
  statsContainer: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  statCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#F3F4F6' },
  statIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  statValue: { fontSize: 18, fontFamily: 'DMSans-Bold', color: '#111827', marginBottom: 2 },
  statLabel: { fontSize: 11, fontFamily: 'DMSans-Regular', color: '#6B7280', textAlign: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#D1FAE5', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 4 },
  emptyText: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#6B7280' },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitleContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  urgentDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' },
  sectionTitle: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  sectionCount: { fontSize: 14, fontFamily: 'DMSans-Medium', color: '#9CA3AF', backgroundColor: '#F3F4F6', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  todoCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#F3F4F6' },
  todoCardCompleted: { opacity: 0.6, backgroundColor: '#F9FAFB' },
  checkbox: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: '#D1D5DB', marginRight: 12, justifyContent: 'center', alignItems: 'center' },
  checkboxCompleted: { backgroundColor: '#22C55E', borderColor: '#22C55E' },
  todoContent: { flex: 1 },
  todoHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  todoIcon: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  todoTitle: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#111827', flex: 1 },
  todoTitleCompleted: { textDecorationLine: 'line-through', color: '#9CA3AF' },
  todoSubtitle: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginBottom: 6, marginLeft: 36 },
  todoFooter: { flexDirection: 'row', alignItems: 'center', marginLeft: 36 },
  todoContact: { fontSize: 12, fontFamily: 'DMSans-Medium', color: '#F97316' },
  todoSeparator: { fontSize: 12, color: '#D1D5DB', marginHorizontal: 6 },
  todoObjekt: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#9CA3AF' },
  // Sync banner
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF7ED',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 16,
    gap: 8,
  },
  syncBannerText: {
    fontSize: 14,
    fontFamily: 'DMSans-Medium',
    color: '#F97316',
  },
  // FAB styles
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 30,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F97316',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'DMSans-Bold',
    color: '#111827',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    fontFamily: 'DMSans-Regular',
    marginBottom: 16,
    backgroundColor: '#F9FAFB',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  inputLabel: {
    fontSize: 14,
    fontFamily: 'DMSans-SemiBold',
    color: '#374151',
    marginBottom: 8,
  },
  typeSelector: {
    marginBottom: 16,
  },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginRight: 8,
    gap: 6,
  },
  typeButtonText: {
    fontSize: 13,
    fontFamily: 'DMSans-Medium',
    color: '#374151',
  },
  prioritySelector: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  priorityButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  priorityButtonActive: {
    backgroundColor: '#F3F4F6',
    borderColor: '#F97316',
  },
  priorityButtonUrgent: {
    backgroundColor: '#EF4444',
    borderColor: '#EF4444',
  },
  priorityButtonText: {
    fontSize: 14,
    fontFamily: 'DMSans-Medium',
    color: '#374151',
  },
  priorityButtonTextActive: {
    color: '#F97316',
  },
  createButton: {
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  createButtonDisabled: {
    opacity: 0.7,
  },
  createButtonText: {
    fontSize: 16,
    fontFamily: 'DMSans-SemiBold',
    color: '#FFFFFF',
  },
});
