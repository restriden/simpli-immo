import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';
import { getLead, getMessages, sendMessage, Lead, Message } from '../../lib/database';
import { sendGHLMessage, subscribeToMessages, checkGHLConnection } from '../../lib/ghl';

const statusLabels: Record<string, { label: string; color: string; bg: string }> = {
  neu: { label: 'Neu', color: '#3B82F6', bg: '#DBEAFE' },
  kontaktiert: { label: 'Kontaktiert', color: '#6B7280', bg: '#F3F4F6' },
  simpli_gesendet: { label: 'Simpli gesendet', color: '#F97316', bg: '#FFF7ED' },
  simpli_bestaetigt: { label: 'Finanziert', color: '#22C55E', bg: '#D1FAE5' },
  extern_finanziert: { label: 'Extern fin.', color: '#8B5CF6', bg: '#EDE9FE' },
  besichtigt: { label: 'Besichtigt', color: '#3B82F6', bg: '#DBEAFE' },
  abgesagt: { label: 'Abgesagt', color: '#EF4444', bg: '#FEE2E2' },
  gekauft: { label: 'Käufer', color: '#22C55E', bg: '#D1FAE5' },
};

export default function ChatScreen() {
  const router = useRouter();
  const { leadId } = useLocalSearchParams<{ leadId: string }>();
  const { user } = useAuth();
  const scrollViewRef = useRef<ScrollView>(null);

  const [lead, setLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [ghlConnected, setGhlConnected] = useState(false);
  const [messageType, setMessageType] = useState<'WhatsApp' | 'SMS' | 'Email'>('WhatsApp');

  // Load data and check GHL connection
  useEffect(() => {
    loadData();
    checkGHL();
  }, [leadId, user?.id]);

  // Subscribe to real-time message updates
  useEffect(() => {
    if (!leadId) return;

    console.log('[CHAT] Setting up real-time subscription for lead:', leadId);
    const unsubscribe = subscribeToMessages(leadId, (newMsg) => {
      console.log('[CHAT] Received real-time message:', newMsg);
      setMessages(prev => {
        // Check for duplicates by id or ghl_message_id
        const isDuplicate = prev.some(m =>
          m.id === newMsg.id ||
          (newMsg.ghl_message_id && m.ghl_message_id === newMsg.ghl_message_id) ||
          (newMsg.ghl_message_id && m.id === newMsg.ghl_message_id)
        );

        if (isDuplicate) {
          console.log('[CHAT] Duplicate message, skipping');
          return prev;
        }

        // Remove any temp messages with same content (optimistic updates)
        const filtered = prev.filter(m => {
          if (typeof m.id === 'string' && m.id.startsWith('temp_')) {
            // Remove temp message if content matches
            return m.content !== newMsg.content;
          }
          return true;
        });

        return [...filtered, newMsg];
      });
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });

    return () => {
      console.log('[CHAT] Cleaning up real-time subscription');
      unsubscribe();
    };
  }, [leadId]);

  const checkGHL = async () => {
    if (!user?.id) return;
    const connection = await checkGHLConnection(user.id);
    setGhlConnected(!!connection);
  };

  const loadData = async () => {
    if (!leadId) return;

    try {
      const [leadData, messagesData] = await Promise.all([
        getLead(leadId),
        getMessages(leadId),
      ]);

      setLead(leadData);
      setMessages(messagesData);
    } catch (error) {
      console.error('Error loading chat:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !user?.id || !leadId) return;

    setSending(true);
    const messageContent = newMessage.trim();
    setNewMessage(''); // Clear immediately for better UX

    try {
      // If GHL is connected and lead has ghl_contact_id, send via GHL
      if (ghlConnected && lead?.ghl_contact_id) {
        console.log('[CHAT] Sending via GHL:', messageType);
        const result = await sendGHLMessage(user.id, leadId, messageContent, messageType);

        if (!result.success) {
          Alert.alert('Fehler', result.error || 'Nachricht konnte nicht gesendet werden');
          setNewMessage(messageContent); // Restore message on error
          return;
        }

        // Message will appear via real-time subscription
        // Add optimistic message with temp_ prefix for immediate UX
        const optimisticMessage: Message = {
          id: `temp_${Date.now()}`,
          lead_id: leadId,
          user_id: user.id,
          content: messageContent,
          type: 'outgoing',
          is_template: false,
          ghl_message_id: result.messageId,
          created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, optimisticMessage]);
      } else {
        // Fallback: Save locally only
        const message = await sendMessage({
          lead_id: leadId,
          user_id: user.id,
          content: messageContent,
          type: 'outgoing',
        });

        if (message) {
          setMessages(prev => [...prev, message]);
        }
      }

      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Fehler', 'Nachricht konnte nicht gesendet werden');
      setNewMessage(messageContent); // Restore message on error
    } finally {
      setSending(false);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Heute';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Gestern';
    }
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Feather name="arrow-left" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Lead nicht gefunden</Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>
    );
  }

  const status = statusLabels[lead.status] || statusLabels.neu;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#111827" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.headerContent}>
          <View style={styles.headerInfo}>
            <View style={styles.headerNameRow}>
              <Text style={styles.headerName}>{lead.name}</Text>
              {lead.source === 'simpli' && (
                <View style={styles.simpliBadge}>
                  <Feather name="zap" size={10} color="#F97316" />
                </View>
              )}
            </View>
            {lead.objekt && (
              <Text style={styles.headerObjekt}>{lead.objekt.name}</Text>
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuButton}>
          <Feather name="more-vertical" size={20} color="#6B7280" />
        </TouchableOpacity>
      </View>

      {/* Status Bar */}
      <View style={styles.statusBar}>
        <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
        {lead.finanzierung_status && (
          <Text style={styles.finanzierungStatus}>
            <Feather name="credit-card" size={12} color="#6B7280" /> {lead.finanzierung_status}
          </Text>
        )}
        {ghlConnected && lead.ghl_contact_id && (
          <View style={styles.ghlBadge}>
            <Feather name="zap" size={12} color="#22C55E" />
            <Text style={styles.ghlBadgeText}>GHL</Text>
          </View>
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Messages */}
        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesContainer}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: false })}
        >
          {messages.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Feather name="message-circle" size={48} color="#D1D5DB" />
              </View>
              <Text style={styles.emptyTitle}>Noch keine Nachrichten</Text>
              <Text style={styles.emptyText}>Starte die Konversation mit diesem Lead</Text>
            </View>
          ) : (
            messages.map((message, index) => {
              const showDate = index === 0 ||
                formatDate(message.created_at) !== formatDate(messages[index - 1].created_at);

              return (
                <View key={message.id}>
                  {showDate && (
                    <View style={styles.dateSeparator}>
                      <Text style={styles.dateText}>{formatDate(message.created_at)}</Text>
                    </View>
                  )}

                  {message.type === 'system' ? (
                    <View style={styles.systemMessage}>
                      <Text style={styles.systemMessageText}>{message.content}</Text>
                    </View>
                  ) : (
                    <View style={[
                      styles.messageBubble,
                      message.type === 'outgoing' ? styles.outgoingBubble : styles.incomingBubble
                    ]}>
                      <Text style={[
                        styles.messageText,
                        message.type === 'outgoing' ? styles.outgoingText : styles.incomingText
                      ]}>
                        {message.content}
                      </Text>
                      <Text style={[
                        styles.messageTime,
                        message.type === 'outgoing' ? styles.outgoingTime : styles.incomingTime
                      ]}>
                        {formatTime(message.created_at)}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>

        {/* Input */}
        <View style={styles.inputContainer}>
          {/* Channel Selector - only show when GHL connected */}
          {ghlConnected && lead?.ghl_contact_id && (
            <View style={styles.channelSelector}>
              <TouchableOpacity
                style={[styles.channelButton, messageType === 'WhatsApp' && styles.channelButtonActive]}
                onPress={() => setMessageType('WhatsApp')}
              >
                <Feather name="message-circle" size={14} color={messageType === 'WhatsApp' ? '#FFFFFF' : '#6B7280'} />
                <Text style={[styles.channelButtonText, messageType === 'WhatsApp' && styles.channelButtonTextActive]}>WhatsApp</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.channelButton, messageType === 'SMS' && styles.channelButtonActive]}
                onPress={() => setMessageType('SMS')}
              >
                <Feather name="smartphone" size={14} color={messageType === 'SMS' ? '#FFFFFF' : '#6B7280'} />
                <Text style={[styles.channelButtonText, messageType === 'SMS' && styles.channelButtonTextActive]}>SMS</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.channelButton, messageType === 'Email' && styles.channelButtonActive]}
                onPress={() => setMessageType('Email')}
              >
                <Feather name="mail" size={14} color={messageType === 'Email' ? '#FFFFFF' : '#6B7280'} />
                <Text style={[styles.channelButtonText, messageType === 'Email' && styles.channelButtonTextActive]}>Email</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.textInput}
              placeholder={ghlConnected ? `${messageType} schreiben...` : "Nachricht schreiben..."}
              placeholderTextColor="#9CA3AF"
              value={newMessage}
              onChangeText={setNewMessage}
              multiline
              maxLength={1000}
            />
            <TouchableOpacity
              style={[styles.sendButton, !newMessage.trim() && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!newMessage.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Feather name="send" size={20} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  backButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  headerContent: { flex: 1, marginLeft: 12 },
  headerInfo: { flex: 1 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerName: { fontSize: 17, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  simpliBadge: { width: 20, height: 20, borderRadius: 5, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  headerObjekt: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },
  menuButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  statusBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 12, fontFamily: 'DMSans-SemiBold' },
  finanzierungStatus: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#6B7280' },
  ghlBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#D1FAE5', marginLeft: 'auto' },
  ghlBadgeText: { fontSize: 11, fontFamily: 'DMSans-SemiBold', color: '#22C55E' },
  keyboardView: { flex: 1 },
  messagesContainer: { flex: 1 },
  messagesContent: { padding: 16, paddingBottom: 20 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyIcon: { width: 80, height: 80, borderRadius: 20, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 4 },
  emptyText: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#6B7280' },
  dateSeparator: { alignItems: 'center', marginVertical: 16 },
  dateText: { fontSize: 12, fontFamily: 'DMSans-Medium', color: '#9CA3AF', backgroundColor: '#F3F4F6', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  systemMessage: { alignItems: 'center', marginVertical: 8 },
  systemMessageText: { fontSize: 12, fontFamily: 'DMSans-Regular', color: '#6B7280', fontStyle: 'italic' },
  messageBubble: { maxWidth: '80%', padding: 12, borderRadius: 16, marginBottom: 8 },
  outgoingBubble: { alignSelf: 'flex-end', backgroundColor: '#F97316', borderBottomRightRadius: 4 },
  incomingBubble: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#F3F4F6' },
  messageText: { fontSize: 15, fontFamily: 'DMSans-Regular', lineHeight: 20 },
  outgoingText: { color: '#FFFFFF' },
  incomingText: { color: '#111827' },
  messageTime: { fontSize: 11, fontFamily: 'DMSans-Regular', marginTop: 4 },
  outgoingTime: { color: 'rgba(255,255,255,0.7)', textAlign: 'right' },
  incomingTime: { color: '#9CA3AF' },
  inputContainer: { backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  channelSelector: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  channelButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#F3F4F6' },
  channelButtonActive: { backgroundColor: '#F97316' },
  channelButtonText: { fontSize: 12, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  channelButtonTextActive: { color: '#FFFFFF' },
  inputWrapper: { flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#F3F4F6', borderRadius: 24, paddingLeft: 16, paddingRight: 4, paddingVertical: 4 },
  textInput: { flex: 1, fontSize: 15, fontFamily: 'DMSans-Regular', color: '#111827', maxHeight: 100, paddingVertical: 8 },
  sendButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F97316', justifyContent: 'center', alignItems: 'center' },
  sendButtonDisabled: { backgroundColor: '#D1D5DB' },
});
