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
  Modal,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { useAuth } from '../../lib/auth';
import { getLead, getMessages, sendMessage, Lead, Message } from '../../lib/database';
import { sendCRMMessage, sendCRMMedia, subscribeToMessages, checkCRMConnection } from '../../lib/crm';

interface PendingQuestion {
  id: string;
  content: string;
  topic_summary: string;
  urgency: 'hoch' | 'mittel' | 'niedrig';
  created_at: string;
}

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
  const [crmConnected, setCrmConnected] = useState(false);
  const [messageType, setMessageType] = useState<'WhatsApp' | 'SMS' | 'Email'>('WhatsApp');
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestion[]>([]);
  const messageRefs = useRef<{ [key: string]: number }>({});

  // Media states
  const [showMediaMenu, setShowMediaMenu] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<{ uri: string; type: 'image' | 'video' | 'audio'; name: string } | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load data and check CRM connection
  useEffect(() => {
    loadData();
    checkCRM();
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

  const checkCRM = async () => {
    if (!user?.id) return;
    const connection = await checkCRMConnection(user.id);
    setCrmConnected(!!connection);
  };

  // Detect unanswered questions from messages
  useEffect(() => {
    const detectPendingQuestions = () => {
      const pending: PendingQuestion[] = [];

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i] as any;

        // Check if this is an incoming message with analysis data
        if (msg.type === 'incoming' && msg.ghl_data?.analysis?.is_question) {
          // Check if there's an outgoing message after this one
          const hasResponse = messages.slice(i + 1).some(m => m.type === 'outgoing');

          if (!hasResponse) {
            pending.push({
              id: msg.id,
              content: msg.content,
              topic_summary: msg.ghl_data.analysis.topic_summary || 'Frage',
              urgency: msg.ghl_data.analysis.urgency || 'mittel',
              created_at: msg.created_at,
            });
          }
        }
      }

      setPendingQuestions(pending);
    };

    detectPendingQuestions();
  }, [messages]);

  const scrollToMessage = (messageId: string) => {
    const yPosition = messageRefs.current[messageId];
    if (yPosition !== undefined && scrollViewRef.current) {
      scrollViewRef.current.scrollTo({ y: yPosition - 100, animated: true });
    }
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
      // If CRM is connected and lead has ghl_contact_id, send via CRM
      if (crmConnected && lead?.ghl_contact_id) {
        console.log('[CHAT] Sending via CRM:', messageType);
        const result = await sendCRMMessage(user.id, leadId, messageContent, messageType);

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

  // Handle taking a photo
  const handleTakePhoto = async () => {
    setShowMediaMenu(false);

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Berechtigung erforderlich', 'Bitte erlaube den Kamerazugriff in den Einstellungen.');
      return;
    }

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        quality: 0.8,
        videoMaxDuration: 60,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const isVideo = asset.type === 'video';
        const filename = isVideo ? `video_${Date.now()}.mp4` : `foto_${Date.now()}.jpg`;

        setSelectedMedia({
          uri: asset.uri,
          type: isVideo ? 'video' : 'image',
          name: filename,
        });
      }
    } catch (error) {
      Alert.alert('Fehler', 'Beim Fotografieren ist ein Fehler aufgetreten.');
    }
  };

  // Handle picking from gallery
  const handlePickMedia = async () => {
    setShowMediaMenu(false);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Berechtigung erforderlich', 'Bitte erlaube den Galerie-Zugriff in den Einstellungen.');
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        quality: 0.8,
        videoMaxDuration: 60,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const isVideo = asset.type === 'video';
        const filename = asset.fileName || (isVideo ? `video_${Date.now()}.mp4` : `bild_${Date.now()}.jpg`);

        setSelectedMedia({
          uri: asset.uri,
          type: isVideo ? 'video' : 'image',
          name: filename,
        });
      }
    } catch (error) {
      Alert.alert('Fehler', 'Beim Auswählen ist ein Fehler aufgetreten.');
    }
  };

  // Handle voice recording
  const handleStartRecording = async () => {
    setShowMediaMenu(false);

    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Berechtigung erforderlich', 'Bitte erlaube den Mikrofon-Zugriff in den Einstellungen.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingDuration(0);

      // Start duration timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Recording error:', error);
      Alert.alert('Fehler', 'Aufnahme konnte nicht gestartet werden.');
    }
  };

  const handleStopRecording = async () => {
    if (!recordingRef.current) return;

    try {
      // Stop timer
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();

      if (uri) {
        setSelectedMedia({
          uri,
          type: 'audio',
          name: `sprachnachricht_${Date.now()}.m4a`,
        });
      }

      recordingRef.current = null;
      setIsRecording(false);
      setRecordingDuration(0);
    } catch (error) {
      console.error('Stop recording error:', error);
      Alert.alert('Fehler', 'Aufnahme konnte nicht gestoppt werden.');
    }
  };

  const handleCancelRecording = async () => {
    if (!recordingRef.current) return;

    try {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      await recordingRef.current.stopAndUnloadAsync();
      recordingRef.current = null;
      setIsRecording(false);
      setRecordingDuration(0);
    } catch (error) {
      console.error('Cancel recording error:', error);
    }
  };

  // Format recording duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Send media
  const handleSendMedia = async () => {
    if (!selectedMedia || !user?.id || !leadId) return;

    setUploadingMedia(true);

    try {
      if (crmConnected && lead?.ghl_contact_id) {
        // Send via CRM
        const result = await sendCRMMedia(user.id, leadId, selectedMedia.uri, selectedMedia.type, selectedMedia.name);

        if (!result.success) {
          Alert.alert('Fehler', result.error || 'Media konnte nicht gesendet werden');
          return;
        }

        // Add optimistic message
        const optimisticMessage: Message = {
          id: `temp_${Date.now()}`,
          lead_id: leadId,
          user_id: user.id,
          content: `[${selectedMedia.type === 'audio' ? 'Sprachnachricht' : selectedMedia.type === 'video' ? 'Video' : 'Bild'}]`,
          type: 'outgoing',
          is_template: false,
          created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, optimisticMessage]);
      } else {
        // Local only - just show message
        const message = await sendMessage({
          lead_id: leadId,
          user_id: user.id,
          content: `[${selectedMedia.type === 'audio' ? 'Sprachnachricht' : selectedMedia.type === 'video' ? 'Video' : 'Bild'}: ${selectedMedia.name}]`,
          type: 'outgoing',
        });

        if (message) {
          setMessages(prev => [...prev, message]);
        }
      }

      setSelectedMedia(null);
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      console.error('Error sending media:', error);
      Alert.alert('Fehler', 'Media konnte nicht gesendet werden');
    } finally {
      setUploadingMedia(false);
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

        <TouchableOpacity style={styles.headerContent} onPress={() => router.push(`/lead/${leadId}`)}>
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
        {crmConnected && lead.ghl_contact_id && (
          <View style={styles.crmBadge}>
            <Feather name="zap" size={12} color="#22C55E" />
            <Text style={styles.crmBadgeText}>Sync</Text>
          </View>
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Pending Questions Banner */}
        {pendingQuestions.length > 0 && (
          <View style={styles.pendingBanner}>
            <View style={styles.pendingHeader}>
              <Feather name="alert-circle" size={16} color="#DC2626" />
              <Text style={styles.pendingTitle}>
                {pendingQuestions.length} offene Frage{pendingQuestions.length > 1 ? 'n' : ''}
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pendingScroll}>
              {pendingQuestions.map((q, idx) => (
                <TouchableOpacity
                  key={q.id}
                  style={[
                    styles.pendingCard,
                    q.urgency === 'hoch' && styles.pendingCardUrgent,
                  ]}
                  onPress={() => scrollToMessage(q.id)}
                >
                  <Text style={styles.pendingTopic} numberOfLines={1}>{q.topic_summary}</Text>
                  <Text style={styles.pendingPreview} numberOfLines={1}>{q.content}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

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

              const isQuestion = (message as any).ghl_data?.analysis?.is_question;
              const isPending = pendingQuestions.some(q => q.id === message.id);

              return (
                <View
                  key={message.id}
                  onLayout={(event) => {
                    messageRefs.current[message.id] = event.nativeEvent.layout.y;
                  }}
                >
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
                      message.type === 'outgoing' ? styles.outgoingBubble : styles.incomingBubble,
                      isPending && styles.pendingQuestionBubble,
                    ]}>
                      {isPending && (
                        <View style={styles.questionIndicator}>
                          <Feather name="help-circle" size={12} color="#DC2626" />
                          <Text style={styles.questionIndicatorText}>Wartet auf Antwort</Text>
                        </View>
                      )}
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

        {/* Selected Media Preview */}
        {selectedMedia && (
          <View style={styles.mediaPreviewContainer}>
            <View style={styles.mediaPreviewContent}>
              {selectedMedia.type === 'image' && (
                <Image source={{ uri: selectedMedia.uri }} style={styles.mediaPreviewImage} />
              )}
              {selectedMedia.type === 'video' && (
                <View style={styles.mediaPreviewVideo}>
                  <Feather name="video" size={32} color="#FFFFFF" />
                  <Text style={styles.mediaPreviewVideoText}>Video</Text>
                </View>
              )}
              {selectedMedia.type === 'audio' && (
                <View style={styles.mediaPreviewAudio}>
                  <Feather name="mic" size={32} color="#F97316" />
                  <Text style={styles.mediaPreviewAudioText}>Sprachnachricht</Text>
                </View>
              )}
            </View>
            <View style={styles.mediaPreviewActions}>
              <TouchableOpacity
                style={styles.mediaPreviewCancel}
                onPress={() => setSelectedMedia(null)}
              >
                <Feather name="x" size={20} color="#6B7280" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.mediaPreviewSend}
                onPress={handleSendMedia}
                disabled={uploadingMedia}
              >
                {uploadingMedia ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Feather name="send" size={20} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Recording UI */}
        {isRecording && (
          <View style={styles.recordingContainer}>
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>Aufnahme läuft</Text>
              <Text style={styles.recordingDuration}>{formatDuration(recordingDuration)}</Text>
            </View>
            <View style={styles.recordingActions}>
              <TouchableOpacity style={styles.recordingCancel} onPress={handleCancelRecording}>
                <Feather name="x" size={24} color="#EF4444" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.recordingStop} onPress={handleStopRecording}>
                <Feather name="check" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Input */}
        {!isRecording && !selectedMedia && (
          <View style={styles.inputContainer}>
            {/* Channel Selector - only show when CRM connected */}
            {crmConnected && lead?.ghl_contact_id && (
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
              <TouchableOpacity style={styles.attachButton} onPress={() => setShowMediaMenu(true)}>
                <Feather name="plus" size={22} color="#6B7280" />
              </TouchableOpacity>
              <TextInput
                style={styles.textInput}
                placeholder={crmConnected ? `${messageType} schreiben...` : "Nachricht schreiben..."}
                placeholderTextColor="#9CA3AF"
                value={newMessage}
                onChangeText={setNewMessage}
                multiline
                maxLength={1000}
              />
              {newMessage.trim() ? (
                <TouchableOpacity
                  style={styles.sendButton}
                  onPress={handleSend}
                  disabled={sending}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Feather name="send" size={20} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.micButton} onPress={handleStartRecording}>
                  <Feather name="mic" size={20} color="#F97316" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Media Menu Modal */}
        <Modal
          visible={showMediaMenu}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setShowMediaMenu(false)}
        >
          <TouchableOpacity
            style={styles.mediaMenuOverlay}
            activeOpacity={1}
            onPress={() => setShowMediaMenu(false)}
          >
            <View style={styles.mediaMenuContent}>
              <View style={styles.mediaMenuHandle} />
              <Text style={styles.mediaMenuTitle}>Anhang hinzufügen</Text>

              <View style={styles.mediaMenuOptions}>
                <TouchableOpacity style={styles.mediaMenuOption} onPress={handleTakePhoto}>
                  <View style={[styles.mediaMenuIcon, { backgroundColor: '#DBEAFE' }]}>
                    <Feather name="camera" size={24} color="#3B82F6" />
                  </View>
                  <Text style={styles.mediaMenuLabel}>Kamera</Text>
                  <Text style={styles.mediaMenuSublabel}>Foto/Video aufnehmen</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.mediaMenuOption} onPress={handlePickMedia}>
                  <View style={[styles.mediaMenuIcon, { backgroundColor: '#D1FAE5' }]}>
                    <Feather name="image" size={24} color="#22C55E" />
                  </View>
                  <Text style={styles.mediaMenuLabel}>Galerie</Text>
                  <Text style={styles.mediaMenuSublabel}>Bild/Video auswählen</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.mediaMenuOption} onPress={handleStartRecording}>
                  <View style={[styles.mediaMenuIcon, { backgroundColor: '#FFF7ED' }]}>
                    <Feather name="mic" size={24} color="#F97316" />
                  </View>
                  <Text style={styles.mediaMenuLabel}>Sprachnachricht</Text>
                  <Text style={styles.mediaMenuSublabel}>Audio aufnehmen</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.mediaMenuCancel}
                onPress={() => setShowMediaMenu(false)}
              >
                <Text style={styles.mediaMenuCancelText}>Abbrechen</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
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
  crmBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#D1FAE5', marginLeft: 'auto' },
  crmBadgeText: { fontSize: 11, fontFamily: 'DMSans-SemiBold', color: '#22C55E' },
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
  inputWrapper: { flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#F3F4F6', borderRadius: 24, paddingLeft: 4, paddingRight: 4, paddingVertical: 4 },
  attachButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  textInput: { flex: 1, fontSize: 15, fontFamily: 'DMSans-Regular', color: '#111827', maxHeight: 100, paddingVertical: 8, paddingHorizontal: 8 },
  sendButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F97316', justifyContent: 'center', alignItems: 'center' },
  sendButtonDisabled: { backgroundColor: '#D1D5DB' },
  micButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  // Media Menu
  mediaMenuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  mediaMenuContent: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  mediaMenuHandle: { width: 40, height: 4, backgroundColor: '#E5E7EB', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  mediaMenuTitle: { fontSize: 18, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 20, textAlign: 'center' },
  mediaMenuOptions: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 24 },
  mediaMenuOption: { alignItems: 'center', flex: 1 },
  mediaMenuIcon: { width: 60, height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  mediaMenuLabel: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  mediaMenuSublabel: { fontSize: 11, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2, textAlign: 'center' },
  mediaMenuCancel: { paddingVertical: 14, backgroundColor: '#F3F4F6', borderRadius: 12, alignItems: 'center' },
  mediaMenuCancelText: { fontSize: 15, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  // Recording UI
  recordingContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FEE2E2', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#FECACA' },
  recordingIndicator: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recordingDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#EF4444' },
  recordingText: { fontSize: 14, fontFamily: 'DMSans-Medium', color: '#DC2626' },
  recordingDuration: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#DC2626', marginLeft: 8 },
  recordingActions: { flexDirection: 'row', gap: 12 },
  recordingCancel: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FEE2E2', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#EF4444' },
  recordingStop: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#22C55E', justifyContent: 'center', alignItems: 'center' },
  // Media Preview
  mediaPreviewContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6', gap: 12 },
  mediaPreviewContent: { flex: 1 },
  mediaPreviewImage: { width: 80, height: 80, borderRadius: 12 },
  mediaPreviewVideo: { width: 80, height: 80, borderRadius: 12, backgroundColor: '#3B82F6', justifyContent: 'center', alignItems: 'center' },
  mediaPreviewVideoText: { fontSize: 11, fontFamily: 'DMSans-Medium', color: '#FFFFFF', marginTop: 4 },
  mediaPreviewAudio: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFF7ED', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  mediaPreviewAudioText: { fontSize: 14, fontFamily: 'DMSans-Medium', color: '#F97316' },
  mediaPreviewActions: { flexDirection: 'row', gap: 8 },
  mediaPreviewCancel: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  mediaPreviewSend: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F97316', justifyContent: 'center', alignItems: 'center' },
  // Pending Questions
  pendingBanner: {
    backgroundColor: '#FEF2F2',
    borderBottomWidth: 1,
    borderBottomColor: '#FECACA',
    paddingVertical: 10,
  },
  pendingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  pendingTitle: {
    fontSize: 13,
    fontFamily: 'DMSans-SemiBold',
    color: '#DC2626',
  },
  pendingScroll: {
    paddingHorizontal: 12,
  },
  pendingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    marginHorizontal: 4,
    minWidth: 140,
    maxWidth: 200,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  pendingCardUrgent: {
    borderColor: '#DC2626',
    borderWidth: 2,
  },
  pendingTopic: {
    fontSize: 12,
    fontFamily: 'DMSans-SemiBold',
    color: '#DC2626',
    marginBottom: 2,
  },
  pendingPreview: {
    fontSize: 11,
    fontFamily: 'DMSans-Regular',
    color: '#6B7280',
  },
  pendingQuestionBubble: {
    borderColor: '#FECACA',
    borderWidth: 2,
  },
  questionIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#FEE2E2',
  },
  questionIndicatorText: {
    fontSize: 10,
    fontFamily: 'DMSans-Medium',
    color: '#DC2626',
  },
});
