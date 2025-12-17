import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';

// Mock extrahierte Daten (später von KI)
const mockExtractedData = {
  grunddaten: {
    titel: 'Moderne 3-Zimmer-Wohnung mit Südbalkon',
    typ: 'Eigentumswohnung',
    adresse: 'Eppendorfer Weg 123',
    plz: '20253',
    stadt: 'Hamburg',
    stadtteil: 'Eppendorf',
  },
  details: {
    wohnflaeche: '85',
    zimmer: '3',
    schlafzimmer: '2',
    badezimmer: '1',
    etage: '2',
    etagenGesamt: '4',
    baujahr: '1998',
    letzteSanierung: '2020',
  },
  preise: {
    kaufpreis: '450000',
    hausgeld: '320',
    grundstuecksanteil: '45',
  },
  ausstattung: [
    'Balkon/Terrasse',
    'Einbauküche',
    'Parkett',
    'Fußbodenheizung',
    'Aufzug',
    'Keller',
    'Fahrradraum',
  ],
  energie: {
    energieausweis: 'Verbrauchsausweis',
    energieeffizienz: 'C',
    energieverbrauch: '95',
    heizungsart: 'Zentralheizung',
    energietraeger: 'Gas',
  },
  beschreibung: 'Diese wunderschöne 3-Zimmer-Wohnung besticht durch ihre helle und freundliche Atmosphäre. Der großzügige Wohn-/Essbereich mit Zugang zum Südbalkon lädt zum Verweilen ein. Die hochwertige Einbauküche ist bereits inklusive.',
};

type ExtractedData = typeof mockExtractedData;
type Step = 'upload' | 'processing' | 'review' | 'success';

export default function MagicUploadScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState<string>('');
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editedData, setEditedData] = useState<ExtractedData | null>(null);

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        setFileName(file.name);
        setStep('processing');
        
        // Simuliere KI-Verarbeitung
        setTimeout(() => {
          setExtractedData(mockExtractedData);
          setEditedData(mockExtractedData);
          setStep('review');
        }, 3000);
      }
    } catch (error) {
      Alert.alert('Fehler', 'Beim Hochladen ist ein Fehler aufgetreten.');
    }
  };

  const handleSave = () => {
    // Hier später: Supabase Insert
    console.log('Speichere Objekt:', editedData);
    setStep('success');
  };

  const updateField = (section: string, field: string, value: string) => {
    if (!editedData) return;
    
    setEditedData({
      ...editedData,
      [section]: {
        ...(editedData as any)[section],
        [field]: value,
      },
    });
  };

  const renderUploadStep = () => (
    <View style={styles.uploadContainer}>
      <View style={styles.uploadIcon}>
        <Feather name="upload-cloud" size={64} color="#F97316" />
      </View>
      
      <Text style={styles.uploadTitle}>Exposé hochladen</Text>
      <Text style={styles.uploadSubtitle}>
        Lade ein PDF-Exposé hoch und die KI extrahiert automatisch alle relevanten Daten.
      </Text>
      
      <TouchableOpacity style={styles.uploadButton} onPress={handlePickDocument}>
        <Feather name="file-plus" size={22} color="#FFFFFF" />
        <Text style={styles.uploadButtonText}>PDF auswählen</Text>
      </TouchableOpacity>
      
      <View style={styles.uploadFeatures}>
        <View style={styles.featureItem}>
          <View style={styles.featureIcon}>
            <Feather name="zap" size={18} color="#F97316" />
          </View>
          <View style={styles.featureContent}>
            <Text style={styles.featureTitle}>Automatische Extraktion</Text>
            <Text style={styles.featureText}>Adresse, Preis, Fläche, Ausstattung...</Text>
          </View>
        </View>
        
        <View style={styles.featureItem}>
          <View style={styles.featureIcon}>
            <Feather name="cpu" size={18} color="#F97316" />
          </View>
          <View style={styles.featureContent}>
            <Text style={styles.featureTitle}>KI-Wissensdatenbank</Text>
            <Text style={styles.featureText}>Alle Fakten werden direkt gespeichert</Text>
          </View>
        </View>
        
        <View style={styles.featureItem}>
          <View style={styles.featureIcon}>
            <Feather name="edit-2" size={18} color="#F97316" />
          </View>
          <View style={styles.featureContent}>
            <Text style={styles.featureTitle}>Überprüfen & Anpassen</Text>
            <Text style={styles.featureText}>Korrigiere Daten vor dem Speichern</Text>
          </View>
        </View>
      </View>
    </View>
  );

  const renderProcessingStep = () => (
    <View style={styles.processingContainer}>
      <View style={styles.processingAnimation}>
        <ActivityIndicator size="large" color="#F97316" />
      </View>
      
      <Text style={styles.processingTitle}>KI analysiert Exposé...</Text>
      <Text style={styles.processingFile}>{fileName}</Text>
      
      <View style={styles.processingSteps}>
        <ProcessingStep icon="file-text" text="PDF wird gelesen" done={true} />
        <ProcessingStep icon="search" text="Daten werden extrahiert" done={true} />
        <ProcessingStep icon="cpu" text="KI verarbeitet Informationen" done={false} active={true} />
        <ProcessingStep icon="database" text="Wissensdatenbank wird vorbereitet" done={false} />
      </View>
    </View>
  );

  const renderReviewStep = () => (
    <ScrollView style={styles.reviewContainer} showsVerticalScrollIndicator={false}>
      <View style={styles.reviewHeader}>
        <View style={styles.reviewSuccess}>
          <Feather name="check-circle" size={24} color="#22C55E" />
        </View>
        <Text style={styles.reviewTitle}>Daten erfolgreich extrahiert!</Text>
        <Text style={styles.reviewSubtitle}>Überprüfe die Daten und passe sie bei Bedarf an.</Text>
      </View>

      {/* Grunddaten */}
      <DataSection
        title="Grunddaten"
        icon="home"
        data={editedData?.grunddaten || {}}
        labels={{
          titel: 'Titel',
          typ: 'Objekttyp',
          adresse: 'Adresse',
          plz: 'PLZ',
          stadt: 'Stadt',
          stadtteil: 'Stadtteil',
        }}
        onEdit={(field, value) => updateField('grunddaten', field, value)}
      />

      {/* Details */}
      <DataSection
        title="Details"
        icon="maximize"
        data={editedData?.details || {}}
        labels={{
          wohnflaeche: 'Wohnfläche (m²)',
          zimmer: 'Zimmer',
          schlafzimmer: 'Schlafzimmer',
          badezimmer: 'Badezimmer',
          etage: 'Etage',
          etagenGesamt: 'Etagen gesamt',
          baujahr: 'Baujahr',
          letzteSanierung: 'Letzte Sanierung',
        }}
        onEdit={(field, value) => updateField('details', field, value)}
      />

      {/* Preise */}
      <DataSection
        title="Preise & Kosten"
        icon="dollar-sign"
        data={editedData?.preise || {}}
        labels={{
          kaufpreis: 'Kaufpreis (€)',
          hausgeld: 'Hausgeld (€/Monat)',
          grundstuecksanteil: 'Grundstücksanteil',
        }}
        onEdit={(field, value) => updateField('preise', field, value)}
      />

      {/* Ausstattung */}
      <View style={styles.dataSection}>
        <View style={styles.dataSectionHeader}>
          <View style={styles.dataSectionIcon}>
            <Feather name="list" size={18} color="#F97316" />
          </View>
          <Text style={styles.dataSectionTitle}>Ausstattung</Text>
        </View>
        <View style={styles.ausstattungContainer}>
          {editedData?.ausstattung.map((item, index) => (
            <View key={index} style={styles.ausstattungTag}>
              <Feather name="check" size={14} color="#22C55E" />
              <Text style={styles.ausstattungText}>{item}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Energie */}
      <DataSection
        title="Energie"
        icon="thermometer"
        data={editedData?.energie || {}}
        labels={{
          energieausweis: 'Energieausweis',
          energieeffizienz: 'Effizienzklasse',
          energieverbrauch: 'Verbrauch (kWh/m²a)',
          heizungsart: 'Heizungsart',
          energietraeger: 'Energieträger',
        }}
        onEdit={(field, value) => updateField('energie', field, value)}
      />

      {/* Beschreibung */}
      <View style={styles.dataSection}>
        <View style={styles.dataSectionHeader}>
          <View style={styles.dataSectionIcon}>
            <Feather name="file-text" size={18} color="#F97316" />
          </View>
          <Text style={styles.dataSectionTitle}>Beschreibung</Text>
        </View>
        <Text style={styles.beschreibungText}>{editedData?.beschreibung}</Text>
      </View>

      {/* KI-Wissen Info */}
      <View style={styles.kiInfoBanner}>
        <Feather name="cpu" size={20} color="#F97316" />
        <View style={styles.kiInfoContent}>
          <Text style={styles.kiInfoTitle}>Automatisch zur Wissensdatenbank</Text>
          <Text style={styles.kiInfoText}>
            Alle extrahierten Fakten werden als KI-Wissen gespeichert und können sofort für Anfragen genutzt werden.
          </Text>
        </View>
      </View>

      {/* Save Button */}
      <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
        <Feather name="check" size={20} color="#FFFFFF" />
        <Text style={styles.saveButtonText}>Objekt anlegen</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );

  const renderSuccessStep = () => (
    <View style={styles.successContainer}>
      <View style={styles.successIcon}>
        <Feather name="check-circle" size={80} color="#22C55E" />
      </View>
      
      <Text style={styles.successTitle}>Objekt erfolgreich angelegt!</Text>
      <Text style={styles.successSubtitle}>
        Das Objekt wurde erstellt und {extractedData?.ausstattung.length || 0}+ Fakten wurden zur KI-Wissensdatenbank hinzugefügt.
      </Text>
      
      <View style={styles.successStats}>
        <View style={styles.successStat}>
          <Text style={styles.successStatValue}>1</Text>
          <Text style={styles.successStatLabel}>Neues Objekt</Text>
        </View>
        <View style={styles.successStatDivider} />
        <View style={styles.successStat}>
          <Text style={styles.successStatValue}>24</Text>
          <Text style={styles.successStatLabel}>KI-Fakten</Text>
        </View>
      </View>
      
      <View style={styles.successButtons}>
        <TouchableOpacity 
          style={styles.successButtonSecondary}
          onPress={() => router.push('/objekt/1')}
        >
          <Feather name="eye" size={18} color="#F97316" />
          <Text style={styles.successButtonSecondaryText}>Objekt ansehen</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.successButtonPrimary}
          onPress={() => {
            setStep('upload');
            setFileName('');
            setExtractedData(null);
            setEditedData(null);
          }}
        >
          <Feather name="plus" size={18} color="#FFFFFF" />
          <Text style={styles.successButtonPrimaryText}>Weiteres Exposé</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Magic Upload</Text>
        <View style={styles.headerRight}>
          <Feather name="cpu" size={20} color="#F97316" />
        </View>
      </View>

      {/* Progress Bar */}
      {step !== 'upload' && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View 
              style={[
                styles.progressFill, 
                { 
                  width: step === 'processing' ? '33%' : step === 'review' ? '66%' : '100%' 
                }
              ]} 
            />
          </View>
          <Text style={styles.progressText}>
            {step === 'processing' && 'Schritt 1/3: Analyse'}
            {step === 'review' && 'Schritt 2/3: Überprüfen'}
            {step === 'success' && 'Schritt 3/3: Fertig'}
          </Text>
        </View>
      )}

      {/* Content */}
      {step === 'upload' && renderUploadStep()}
      {step === 'processing' && renderProcessingStep()}
      {step === 'review' && renderReviewStep()}
      {step === 'success' && renderSuccessStep()}
    </SafeAreaView>
  );
}

// Hilfskomponenten
function ProcessingStep({ icon, text, done, active }: { icon: string; text: string; done: boolean; active?: boolean }) {
  return (
    <View style={[styles.processingStep, active && styles.processingStepActive]}>
      <View style={[styles.processingStepIcon, done && styles.processingStepIconDone, active && styles.processingStepIconActive]}>
        {done ? (
          <Feather name="check" size={14} color="#FFFFFF" />
        ) : (
          <Feather name={icon as any} size={14} color={active ? '#FFFFFF' : '#9CA3AF'} />
        )}
      </View>
      <Text style={[styles.processingStepText, done && styles.processingStepTextDone, active && styles.processingStepTextActive]}>
        {text}
      </Text>
    </View>
  );
}

function DataSection({ 
  title, 
  icon, 
  data, 
  labels, 
  onEdit 
}: { 
  title: string; 
  icon: string; 
  data: Record<string, string>; 
  labels: Record<string, string>;
  onEdit: (field: string, value: string) => void;
}) {
  return (
    <View style={styles.dataSection}>
      <View style={styles.dataSectionHeader}>
        <View style={styles.dataSectionIcon}>
          <Feather name={icon as any} size={18} color="#F97316" />
        </View>
        <Text style={styles.dataSectionTitle}>{title}</Text>
      </View>
      
      {Object.entries(labels).map(([key, label]) => (
        <View key={key} style={styles.dataRow}>
          <Text style={styles.dataLabel}>{label}</Text>
          <TextInput
            style={styles.dataInput}
            value={data[key] || ''}
            onChangeText={(value) => onEdit(key, value)}
            placeholder="-"
            placeholderTextColor="#D1D5DB"
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  backButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  headerRight: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  progressContainer: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#F9FAFB' },
  progressBar: { height: 4, backgroundColor: '#E5E7EB', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#F97316', borderRadius: 2 },
  progressText: { fontSize: 12, fontFamily: 'DMSans-Medium', color: '#6B7280', marginTop: 8, textAlign: 'center' },
  
  // Upload Step
  uploadContainer: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  uploadIcon: { width: 120, height: 120, borderRadius: 30, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  uploadTitle: { fontSize: 24, fontFamily: 'DMSans-Bold', color: '#111827', marginBottom: 8, textAlign: 'center' },
  uploadSubtitle: { fontSize: 15, fontFamily: 'DMSans-Regular', color: '#6B7280', textAlign: 'center', paddingHorizontal: 20, marginBottom: 32, lineHeight: 22 },
  uploadButton: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F97316', paddingHorizontal: 32, paddingVertical: 16, borderRadius: 16 },
  uploadButtonText: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#FFFFFF' },
  uploadFeatures: { marginTop: 48, width: '100%' },
  featureItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  featureIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  featureContent: { flex: 1, marginLeft: 14 },
  featureTitle: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  featureText: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 1 },
  
  // Processing Step
  processingContainer: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  processingAnimation: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  processingTitle: { fontSize: 20, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 8 },
  processingFile: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#6B7280', marginBottom: 40 },
  processingSteps: { width: '100%', paddingHorizontal: 20 },
  processingStep: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, opacity: 0.5 },
  processingStepActive: { opacity: 1 },
  processingStepIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  processingStepIconDone: { backgroundColor: '#22C55E' },
  processingStepIconActive: { backgroundColor: '#F97316' },
  processingStepText: { fontSize: 14, fontFamily: 'DMSans-Medium', color: '#9CA3AF', marginLeft: 12 },
  processingStepTextDone: { color: '#22C55E' },
  processingStepTextActive: { color: '#111827' },
  
  // Review Step
  reviewContainer: { flex: 1, padding: 16 },
  reviewHeader: { alignItems: 'center', marginBottom: 24 },
  reviewSuccess: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#D1FAE5', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  reviewTitle: { fontSize: 20, fontFamily: 'DMSans-Bold', color: '#111827', marginBottom: 4 },
  reviewSubtitle: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#6B7280', textAlign: 'center' },
  dataSection: { backgroundColor: '#F9FAFB', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#F3F4F6' },
  dataSectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  dataSectionIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' },
  dataSectionTitle: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#111827', marginLeft: 10 },
  dataRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  dataLabel: { width: 140, fontSize: 13, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  dataInput: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: 'DMSans-Regular', color: '#111827', borderWidth: 1, borderColor: '#E5E7EB' },
  ausstattungContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ausstattungTag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#D1FAE5', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  ausstattungText: { fontSize: 13, fontFamily: 'DMSans-Medium', color: '#166534' },
  beschreibungText: { fontSize: 14, fontFamily: 'DMSans-Regular', color: '#374151', lineHeight: 22 },
  kiInfoBanner: { flexDirection: 'row', backgroundColor: '#FFF7ED', borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: '#FFEDD5' },
  kiInfoContent: { flex: 1, marginLeft: 12 },
  kiInfoTitle: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#111827', marginBottom: 2 },
  kiInfoText: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', lineHeight: 18 },
  saveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#22C55E', paddingVertical: 16, borderRadius: 14 },
  saveButtonText: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#FFFFFF' },
  
  // Success Step
  successContainer: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  successIcon: { marginBottom: 24 },
  successTitle: { fontSize: 24, fontFamily: 'DMSans-Bold', color: '#111827', marginBottom: 8, textAlign: 'center' },
  successSubtitle: { fontSize: 15, fontFamily: 'DMSans-Regular', color: '#6B7280', textAlign: 'center', paddingHorizontal: 20, marginBottom: 32, lineHeight: 22 },
  successStats: { flexDirection: 'row', backgroundColor: '#F9FAFB', borderRadius: 16, padding: 20, marginBottom: 32 },
  successStat: { flex: 1, alignItems: 'center' },
  successStatValue: { fontSize: 28, fontFamily: 'DMSans-Bold', color: '#111827' },
  successStatLabel: { fontSize: 13, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },
  successStatDivider: { width: 1, backgroundColor: '#E5E7EB', marginHorizontal: 20 },
  successButtons: { flexDirection: 'row', gap: 12, width: '100%' },
  successButtonSecondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: '#FFF7ED', borderRadius: 12, borderWidth: 1, borderColor: '#FFEDD5' },
  successButtonSecondaryText: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#F97316' },
  successButtonPrimary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: '#F97316', borderRadius: 12 },
  successButtonPrimaryText: { fontSize: 15, fontFamily: 'DMSans-SemiBold', color: '#FFFFFF' },
});
