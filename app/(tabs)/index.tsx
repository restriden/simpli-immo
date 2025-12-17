import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';

const mockTodos = [
  {
    id: '1',
    type: 'nachricht',
    priority: 'dringend',
    title: 'Neue Nachricht beantworten',
    subtitle: 'Frage zur Wohnfläche',
    kontaktName: 'Max Mustermann',
    objektName: 'Musterstraße 5',
    icon: 'message-circle',
    color: '#EF4444',
  },
  {
    id: '2',
    type: 'finanzierung',
    priority: 'dringend',
    title: 'Finanzierungsanfrage prüfen',
    subtitle: 'Simpli Finance Rückmeldung',
    kontaktName: 'Anna Schmidt',
    objektName: 'Musterstraße 5',
    icon: 'credit-card',
    color: '#F97316',
  },
  {
    id: '3',
    type: 'besichtigung',
    priority: 'normal',
    title: 'Besichtigung bestätigen',
    subtitle: 'Morgen, 14:00 Uhr',
    kontaktName: 'Peter Meier',
    objektName: 'Beispielweg 10',
    icon: 'calendar',
    color: '#3B82F6',
  },
  {
    id: '4',
    type: 'anruf',
    priority: 'normal',
    title: 'Rückruf vereinbaren',
    subtitle: 'Interessent wartet auf Antwort',
    kontaktName: 'Lisa Weber',
    objektName: 'Beispielweg 10',
    icon: 'phone',
    color: '#22C55E',
  },
];

const mockStats = {
  openTodos: 4,
  activeObjekte: 2,
  monthlyProvision: 2450,
};

export default function HomeScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [completedTodos, setCompletedTodos] = useState<string[]>([]);

  const firstName = profile?.full_name?.split(' ')[0] || 'Makler';

  const onRefresh = async () => {
    setRefreshing(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setRefreshing(false);
  };

  const toggleTodo = (todoId: string) => {
    setCompletedTodos(prev =>
      prev.includes(todoId)
        ? prev.filter(id => id !== todoId)
        : [...prev, todoId]
    );
  };

  const dringendeTodos = mockTodos.filter(t => t.priority === 'dringend');
  const normaleTodos = mockTodos.filter(t => t.priority === 'normal');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.greeting}>Willkommen zurück,</Text>
            <Text style={styles.userName}>{firstName}</Text>
          </View>
          <TouchableOpacity style={styles.provisionButton}>
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
            <Text style={styles.statValue}>{mockStats.openTodos}</Text>
            <Text style={styles.statLabel}>Offene To-Dos</Text>
          </View>
          
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: '#DBEAFE' }]}>
              <Feather name="home" size={20} color="#3B82F6" />
            </View>
            <Text style={styles.statValue}>{mockStats.activeObjekte}</Text>
            <Text style={styles.statLabel}>Aktive Objekte</Text>
          </View>
          
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: '#D1FAE5' }]}>
              <Feather name="trending-up" size={20} color="#22C55E" />
            </View>
            <Text style={styles.statValue}>€{mockStats.monthlyProvision.toLocaleString()}</Text>
            <Text style={styles.statLabel}>Provision MTD</Text>
          </View>
        </View>

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
                onPress={() => {}}
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
                onPress={() => {}}
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
  todo: typeof mockTodos[0];
  completed: boolean;
  onToggle: () => void;
  onPress: () => void;
}) {
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
          <View style={[styles.todoIcon, { backgroundColor: `${todo.color}15` }]}>
            <Feather name={todo.icon as any} size={16} color={todo.color} />
          </View>
          <Text style={[styles.todoTitle, completed && styles.todoTitleCompleted]}>
            {todo.title}
          </Text>
        </View>
        <Text style={styles.todoSubtitle}>{todo.subtitle}</Text>
        <View style={styles.todoFooter}>
          <Text style={styles.todoContact}>{todo.kontaktName}</Text>
          <Text style={styles.todoSeparator}>•</Text>
          <Text style={styles.todoObjekt}>{todo.objektName}</Text>
        </View>
      </View>
      
      <Feather name="chevron-right" size={20} color="#D1D5DB" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    backgroundColor: '#F97316',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: {
    fontSize: 14,
    fontFamily: 'DMSans-Regular',
    color: 'rgba(255,255,255,0.8)',
  },
  userName: {
    fontSize: 24,
    fontFamily: 'DMSans-Bold',
    color: '#FFFFFF',
  },
  provisionButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 18,
    fontFamily: 'DMSans-Bold',
    color: '#111827',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    fontFamily: 'DMSans-Regular',
    color: '#6B7280',
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  urgentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'DMSans-SemiBold',
    color: '#111827',
  },
  sectionCount: {
    fontSize: 14,
    fontFamily: 'DMSans-Medium',
    color: '#9CA3AF',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  todoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  todoCardCompleted: {
    opacity: 0.6,
    backgroundColor: '#F9FAFB',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxCompleted: {
    backgroundColor: '#22C55E',
    borderColor: '#22C55E',
  },
  todoContent: {
    flex: 1,
  },
  todoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  todoIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  todoTitle: {
    fontSize: 15,
    fontFamily: 'DMSans-SemiBold',
    color: '#111827',
    flex: 1,
  },
  todoTitleCompleted: {
    textDecorationLine: 'line-through',
    color: '#9CA3AF',
  },
  todoSubtitle: {
    fontSize: 13,
    fontFamily: 'DMSans-Regular',
    color: '#6B7280',
    marginBottom: 6,
    marginLeft: 36,
  },
  todoFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 36,
  },
  todoContact: {
    fontSize: 12,
    fontFamily: 'DMSans-Medium',
    color: '#F97316',
  },
  todoSeparator: {
    fontSize: 12,
    color: '#D1D5DB',
    marginHorizontal: 6,
  },
  todoObjekt: {
    fontSize: 12,
    fontFamily: 'DMSans-Regular',
    color: '#9CA3AF',
  },
});
