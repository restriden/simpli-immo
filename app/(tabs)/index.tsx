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
import { getTodos, getDashboardStats, Todo } from '../../lib/database';
import { completeGHLTask, subscribeToTodos } from '../../lib/ghl';

const todoIcons: Record<string, { icon: string; color: string }> = {
  nachricht: { icon: 'message-circle', color: '#EF4444' },
  finanzierung: { icon: 'credit-card', color: '#F97316' },
  besichtigung: { icon: 'calendar', color: '#3B82F6' },
  anruf: { icon: 'phone', color: '#22C55E' },
  sonstiges: { icon: 'check-circle', color: '#6B7280' },
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

  const firstName = profile?.full_name?.split(' ')[0] || 'Makler';

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
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
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
});
