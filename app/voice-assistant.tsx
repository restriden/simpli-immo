import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

const exampleCommands = [
  { icon: 'message-circle', text: 'Beantworte alle offenen Nachrichten' },
  { icon: 'calendar', text: 'Zeige mir die Termine für heute' },
  { icon: 'users', text: 'Welche Leads warten auf Finanzierung?' },
  { icon: 'home', text: 'Was ist der Status der Musterstraße 5?' },
];

export default function VoiceAssistantScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<'speak' | 'type'>('speak');
  const [isListening, setIsListening] = useState(false);
  const [inputText, setInputText] = useState('');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
          <Feather name="x" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.title}>Magic Assistant</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.modeContainer}>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'speak' && styles.modeButtonActive]}
          onPress={() => setMode('speak')}
        >
          <Feather name="mic" size={18} color={mode === 'speak' ? '#FFFFFF' : '#6B7280'} />
          <Text style={[styles.modeText, mode === 'speak' && styles.modeTextActive]}>Sprechen</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'type' && styles.modeButtonActive]}
          onPress={() => setMode('type')}
        >
          <Feather name="type" size={18} color={mode === 'type' ? '#FFFFFF' : '#6B7280'} />
          <Text style={[styles.modeText, mode === 'type' && styles.modeTextActive]}>Tippen</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <View style={styles.illustrationContainer}>
          <View style={styles.illustration}>
            <View style={styles.assistantIcon}>
              <Feather name="zap" size={40} color="#FFFFFF" />
            </View>
          </View>
          <Text style={styles.assistantText}>
            {isListening ? 'Ich höre dir zu...' : mode === 'speak' ? 'Tippe auf das Mikrofon' : 'Schreibe deine Frage'}
          </Text>
        </View>

        <View style={styles.examplesSection}>
          <Text style={styles.examplesTitle}>Probiere zum Beispiel:</Text>
          {exampleCommands.map((cmd, index) => (
            <TouchableOpacity key={index} style={styles.exampleCard} onPress={() => mode === 'type' && setInputText(cmd.text)}>
              <View style={styles.exampleIcon}>
                <Feather name={cmd.icon as any} size={18} color="#F97316" />
              </View>
              <Text style={styles.exampleText}>{cmd.text}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <View style={styles.bottomArea}>
        {mode === 'speak' ? (
          <TouchableOpacity
            style={[styles.micButton, isListening && styles.micButtonActive]}
            onPress={() => setIsListening(!isListening)}
          >
            <View style={[styles.micInner, isListening && styles.micInnerActive]}>
              <Feather name={isListening ? 'mic-off' : 'mic'} size={32} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Schreibe deine Frage..."
              placeholderTextColor="#9CA3AF"
              value={inputText}
              onChangeText={setInputText}
              multiline
            />
            <TouchableOpacity style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]} disabled={!inputText.trim()}>
              <Feather name="send" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  closeButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 18, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  modeContainer: { flexDirection: 'row', marginHorizontal: 20, padding: 4, backgroundColor: '#F3F4F6', borderRadius: 12, marginBottom: 20 },
  modeButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  modeButtonActive: { backgroundColor: '#F97316' },
  modeText: { fontSize: 14, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  modeTextActive: { color: '#FFFFFF' },
  content: { flex: 1 },
  contentContainer: { paddingHorizontal: 20, paddingBottom: 20 },
  illustrationContainer: { alignItems: 'center', marginTop: 40, marginBottom: 40 },
  illustration: { position: 'relative', width: 120, height: 120, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  assistantIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#F97316', justifyContent: 'center', alignItems: 'center', shadowColor: '#F97316', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8 },
  assistantText: { fontSize: 16, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  examplesSection: { marginTop: 10 },
  examplesTitle: { fontSize: 14, fontFamily: 'DMSans-Medium', color: '#6B7280', marginBottom: 12 },
  exampleCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#F3F4F6' },
  exampleIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  exampleText: { flex: 1, fontSize: 14, fontFamily: 'DMSans-Regular', color: '#374151', marginLeft: 12 },
  bottomArea: { paddingHorizontal: 20, paddingVertical: 20, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  micButton: { alignSelf: 'center', width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(249, 115, 22, 0.1)', justifyContent: 'center', alignItems: 'center' },
  micButtonActive: { backgroundColor: 'rgba(239, 68, 68, 0.1)' },
  micInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#F97316', justifyContent: 'center', alignItems: 'center', shadowColor: '#F97316', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  micInnerActive: { backgroundColor: '#EF4444', shadowColor: '#EF4444' },
  inputContainer: { flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#F9FAFB', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: '#E5E7EB' },
  input: { flex: 1, fontSize: 15, fontFamily: 'DMSans-Regular', color: '#111827', maxHeight: 100, paddingVertical: 8 },
  sendButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F97316', justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  sendButtonDisabled: { backgroundColor: '#D1D5DB' },
});
