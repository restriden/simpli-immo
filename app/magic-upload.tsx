import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../lib/auth';
import { updateObjekt, getObjekt } from '../lib/database';

const SUPABASE_URL = 'https://hsfrdovpgxtqbitmkrhs.supabase.co';

interface ExtractedData {
  strasse?: string;
  hausnummer?: string;
  plz?: string;
  city?: string;
  grundstueck_qm?: number;
  area_sqm?: number;
  nutzflaeche_qm?: number;
  baujahr?: number;
  objektart?: string;
  rooms?: number;
  etage?: number;
  stockwerke_gesamt?: number;
  energieausweis_typ?: string;
  energiekennwert?: number;
  energieeffizienzklasse?: string;
  heizungsart?: string;
  heizung_baujahr?: number;
  keller?: boolean;
  garage_stellplatz?: string;
  price?: number;
  hausgeld_monatlich?: number;
  instandhaltungsruecklage?: number;
  einheiten_im_haus?: number;
  provision_prozent?: number;
  grunderwerbsteuer_prozent?: number;
  denkmalschutz?: boolean;
  erbbaurecht?: boolean;
  [key: string]: any;
}

interface AnalysisResult {
  success: boolean;
  extrahierte_daten: ExtractedData;
  ki_wissen_count: number;
  zusammenfassung: string;
  konfidenz: number;
  felder_aktualisiert: string[];
}

type Step = 'upload' | 'processing' | 'review' | 'success';

// Dokumenttyp-Optionen
const DOKUMENT_TYPEN = [
  { key: 'expose', label: 'Exposé', icon: 'file-text' },
  { key: 'energieausweis', label: 'Energieausweis', icon: 'thermometer' },
  { key: 'grundbuch', label: 'Grundbuchauszug', icon: 'book' },
  { key: 'teilungserklaerung', label: 'Teilungserklärung', icon: 'layers' },
  { key: 'auto', label: 'Automatisch erkennen', icon: 'cpu' },
];

// Feld-Labels für Anzeige
const FELD_LABELS: Record<string, string> = {
  strasse: 'Straße',
  hausnummer: 'Hausnummer',
  plz: 'PLZ',
  city: 'Stadt/Ort',
  grundstueck_qm: 'Grundstück (m²)',
  area_sqm: 'Wohnfläche (m²)',
  nutzflaeche_qm: 'Nutzfläche (m²)',
  baujahr: 'Baujahr',
  objektart: 'Objektart',
  rooms: 'Zimmer',
  etage: 'Etage',
  stockwerke_gesamt: 'Stockwerke gesamt',
  energieausweis_typ: 'Energieausweis-Typ',
  energiekennwert: 'Energiekennwert (kWh/m²a)',
  energieeffizienzklasse: 'Effizienzklasse',
  heizungsart: 'Heizungsart',
  heizung_baujahr: 'Baujahr Heizung',
  keller: 'Keller vorhanden',
  garage_stellplatz: 'Garage/Stellplatz',
  price: 'Kaufpreis (€)',
  hausgeld_monatlich: 'Hausgeld (€/Monat)',
  instandhaltungsruecklage: 'Instandhaltungsrücklage (€)',
  einheiten_im_haus: 'Einheiten im Haus',
  provision_prozent: 'Provision (%)',
  grunderwerbsteuer_prozent: 'Grunderwerbsteuer (%)',
  denkmalschutz: 'Denkmalschutz',
  erbbaurecht: 'Erbbaurecht',
};

export default function MagicUploadScreen() {
  const router = useRouter();
  const { objektId } = useLocalSearchParams<{ objektId: string }>();
  const { user, session } = useAuth();

  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState<string>('');
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [dokumentTyp, setDokumentTyp] = useState<string>('auto');
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [editedData, setEditedData] = useState<ExtractedData | null>(null);
  const [processing, setProcessing] = useState(false);

  // Upload und KI-Analyse durchführen
  const analyzeDocument = async (fileUri: string, fileName: string, mimeType: string) => {
    if (!objektId || !user?.id || !session?.access_token) {
      Alert.alert('Fehler', 'Bitte wähle zuerst ein Objekt aus.');
      return;
    }

    setStep('processing');
    setProcessing(true);

    try {
      // Datei als Blob lesen
      const response = await fetch(fileUri);
      const blob = await response.blob();

      // FormData erstellen
      const formData = new FormData();
      formData.append('file', {
        uri: fileUri,
        name: fileName,
        type: mimeType,
      } as any);
      formData.append('objekt_id', objektId);
      formData.append('user_id', user.id);
      formData.append('dokument_typ', dokumentTyp);

      // Edge Function aufrufen
      const result = await fetch(`${SUPABASE_URL}/functions/v1/analyze-dokument`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const data = await result.json();

      if (!result.ok || !data.success) {
        throw new Error(data.error || 'Analyse fehlgeschlagen');
      }

      setAnalysisResult(data);
      setExtractedData(data.extrahierte_daten);
      setEditedData(data.extrahierte_daten);
      setStep('review');

    } catch (error: any) {
      console.error('Analyse error:', error);
      Alert.alert('Fehler', error.message || 'Bei der Analyse ist ein Fehler aufgetreten.');
      setStep('upload');
    } finally {
      setProcessing(false);
    }
  };

  // PDF auswählen
  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        setFileName(file.name);
        if (file.mimeType?.startsWith('image/')) {
          setFilePreview(file.uri);
        }
        await analyzeDocument(file.uri, file.name, file.mimeType || 'application/pdf');
      }
    } catch (error) {
      Alert.alert('Fehler', 'Beim Hochladen ist ein Fehler aufgetreten.');
    }
  };

  // Foto aufnehmen
  const handleTakePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Berechtigung erforderlich', 'Bitte erlaube den Kamerazugriff in den Einstellungen.');
      return;
    }

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const filename = `foto_${Date.now()}.jpg`;
        setFileName(filename);
        setFilePreview(asset.uri);
        await analyzeDocument(asset.uri, filename, 'image/jpeg');
      }
    } catch (error) {
      Alert.alert('Fehler', 'Beim Fotografieren ist ein Fehler aufgetreten.');
    }
  };

  // Galerie-Bild auswählen
  const handlePickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Berechtigung erforderlich', 'Bitte erlaube den Galerie-Zugriff in den Einstellungen.');
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const filename = asset.fileName || `bild_${Date.now()}.jpg`;
        setFileName(filename);
        setFilePreview(asset.uri);
        await analyzeDocument(asset.uri, filename, 'image/jpeg');
      }
    } catch (error) {
      Alert.alert('Fehler', 'Beim Auswählen ist ein Fehler aufgetreten.');
    }
  };

  // Daten speichern
  const handleSave = async () => {
    if (!objektId || !editedData) return;

    try {
      await updateObjekt(objektId, editedData);
      setStep('success');
    } catch (error) {
      Alert.alert('Fehler', 'Beim Speichern ist ein Fehler aufgetreten.');
    }
  };

  // Feld aktualisieren
  const updateField = (field: string, value: any) => {
    if (!editedData) return;
    setEditedData({ ...editedData, [field]: value });
  };

  const renderUploadStep = () => (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.uploadContainer}>
      <View style={styles.uploadIcon}>
        <Feather name="upload-cloud" size={64} color="#F97316" />
      </View>

      <Text style={styles.uploadTitle}>Dokument scannen</Text>
      <Text style={styles.uploadSubtitle}>
        Lade ein Dokument hoch und die KI extrahiert automatisch alle relevanten Daten.
      </Text>

      {/* Dokumenttyp-Auswahl */}
      <View style={styles.dokumentTypContainer}>
        <Text style={styles.dokumentTypLabel}>Dokumenttyp:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dokumentTypScroll}>
          {DOKUMENT_TYPEN.map((typ) => (
            <TouchableOpacity
              key={typ.key}
              style={[styles.dokumentTypButton, dokumentTyp === typ.key && styles.dokumentTypButtonActive]}
              onPress={() => setDokumentTyp(typ.key)}
            >
              <Feather name={typ.icon as any} size={16} color={dokumentTyp === typ.key ? '#FFFFFF' : '#6B7280'} />
              <Text style={[styles.dokumentTypText, dokumentTyp === typ.key && styles.dokumentTypTextActive]}>
                {typ.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Upload-Optionen */}
      <View style={styles.uploadOptions}>
        <TouchableOpacity style={styles.uploadOptionButton} onPress={handlePickDocument}>
          <View style={[styles.uploadOptionIcon, { backgroundColor: '#FFF7ED' }]}>
            <Feather name="file-plus" size={24} color="#F97316" />
          </View>
          <Text style={styles.uploadOptionTitle}>PDF/Bild</Text>
          <Text style={styles.uploadOptionText}>Datei auswählen</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.uploadOptionButton} onPress={handleTakePhoto}>
          <View style={[styles.uploadOptionIcon, { backgroundColor: '#DBEAFE' }]}>
            <Feather name="camera" size={24} color="#3B82F6" />
          </View>
          <Text style={styles.uploadOptionTitle}>Foto</Text>
          <Text style={styles.uploadOptionText}>Jetzt aufnehmen</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.uploadOptionButton} onPress={handlePickImage}>
          <View style={[styles.uploadOptionIcon, { backgroundColor: '#D1FAE5' }]}>
            <Feather name="image" size={24} color="#22C55E" />
          </View>
          <Text style={styles.uploadOptionTitle}>Galerie</Text>
          <Text style={styles.uploadOptionText}>Bild wählen</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.uploadFeatures}>
        <View style={styles.featureItem}>
          <View style={styles.featureIcon}>
            <Feather name="zap" size={18} color="#F97316" />
          </View>
          <View style={styles.featureContent}>
            <Text style={styles.featureTitle}>Automatische Extraktion</Text>
            <Text style={styles.featureText}>Adresse, Preis, Energie, Ausstattung...</Text>
          </View>
        </View>

        <View style={styles.featureItem}>
          <View style={styles.featureIcon}>
            <Feather name="cpu" size={18} color="#F97316" />
          </View>
          <View style={styles.featureContent}>
            <Text style={styles.featureTitle}>KI-Wissensdatenbank</Text>
            <Text style={styles.featureText}>Fakten werden automatisch gespeichert</Text>
          </View>
        </View>

        <View style={styles.featureItem}>
          <View style={styles.featureIcon}>
            <Feather name="percent" size={18} color="#F97316" />
          </View>
          <View style={styles.featureContent}>
            <Text style={styles.featureTitle}>Vollständigkeit erhöhen</Text>
            <Text style={styles.featureText}>Daten für Finanzierung automatisch füllen</Text>
          </View>
        </View>
      </View>
    </ScrollView>
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

  const renderReviewStep = () => {
    // Gruppiere Felder nach Kategorie
    const stammdatenFelder = ['strasse', 'hausnummer', 'plz', 'city', 'objektart', 'rooms', 'area_sqm', 'grundstueck_qm', 'baujahr', 'etage', 'stockwerke_gesamt'];
    const energieFelder = ['energieausweis_typ', 'energiekennwert', 'energieeffizienzklasse', 'heizungsart', 'heizung_baujahr'];
    const ausstattungFelder = ['keller', 'garage_stellplatz', 'fenster_material', 'dach_material'];
    const finanzFelder = ['price', 'hausgeld_monatlich', 'instandhaltungsruecklage', 'provision_prozent', 'grunderwerbsteuer_prozent', 'einheiten_im_haus'];
    const rechtFelder = ['denkmalschutz', 'erbbaurecht', 'grundbuch_belastungen', 'baulasten'];

    const renderFieldGroup = (title: string, icon: string, fields: string[]) => {
      const relevantData = fields.filter(f => editedData && editedData[f] !== null && editedData[f] !== undefined);
      if (relevantData.length === 0) return null;

      return (
        <View style={styles.dataSection}>
          <View style={styles.dataSectionHeader}>
            <View style={styles.dataSectionIcon}>
              <Feather name={icon as any} size={18} color="#F97316" />
            </View>
            <Text style={styles.dataSectionTitle}>{title}</Text>
          </View>
          {fields.map((field) => {
            const value = editedData?.[field];
            if (value === null || value === undefined) return null;

            const isBoolean = typeof value === 'boolean';
            const displayValue = isBoolean ? (value ? 'Ja' : 'Nein') : String(value);

            return (
              <View key={field} style={styles.dataRow}>
                <Text style={styles.dataLabel}>{FELD_LABELS[field] || field}</Text>
                <TextInput
                  style={styles.dataInput}
                  value={displayValue}
                  onChangeText={(v) => {
                    if (isBoolean) {
                      updateField(field, v.toLowerCase() === 'ja');
                    } else if (typeof value === 'number') {
                      updateField(field, parseFloat(v) || 0);
                    } else {
                      updateField(field, v);
                    }
                  }}
                  placeholder="-"
                  placeholderTextColor="#D1D5DB"
                />
              </View>
            );
          })}
        </View>
      );
    };

    return (
      <ScrollView style={styles.reviewContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.reviewHeader}>
          <View style={styles.reviewSuccess}>
            <Feather name="check-circle" size={24} color="#22C55E" />
          </View>
          <Text style={styles.reviewTitle}>Daten erfolgreich extrahiert!</Text>
          <Text style={styles.reviewSubtitle}>
            {analysisResult?.felder_aktualisiert?.length || 0} Felder gefunden •
            Konfidenz: {Math.round((analysisResult?.konfidenz || 0) * 100)}%
          </Text>
        </View>

        {/* Zusammenfassung */}
        {analysisResult?.zusammenfassung && (
          <View style={styles.summaryBanner}>
            <Feather name="info" size={18} color="#3B82F6" />
            <Text style={styles.summaryText}>{analysisResult.zusammenfassung}</Text>
          </View>
        )}

        {renderFieldGroup('Stammdaten', 'home', stammdatenFelder)}
        {renderFieldGroup('Energie', 'thermometer', energieFelder)}
        {renderFieldGroup('Ausstattung', 'list', ausstattungFelder)}
        {renderFieldGroup('Finanzierung', 'dollar-sign', finanzFelder)}
        {renderFieldGroup('Rechtliches', 'shield', rechtFelder)}

        {/* KI-Wissen Info */}
        {analysisResult && analysisResult.ki_wissen_count > 0 && (
          <View style={styles.kiInfoBanner}>
            <Feather name="cpu" size={20} color="#F97316" />
            <View style={styles.kiInfoContent}>
              <Text style={styles.kiInfoTitle}>{analysisResult.ki_wissen_count} Wissenseinträge erstellt</Text>
              <Text style={styles.kiInfoText}>
                Die extrahierten Fakten wurden automatisch zur KI-Wissensdatenbank hinzugefügt.
              </Text>
            </View>
          </View>
        )}

        {/* Save Button */}
        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <Feather name="check" size={20} color="#FFFFFF" />
          <Text style={styles.saveButtonText}>Änderungen speichern</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  };

  const renderSuccessStep = () => (
    <View style={styles.successContainer}>
      <View style={styles.successIcon}>
        <Feather name="check-circle" size={80} color="#22C55E" />
      </View>

      <Text style={styles.successTitle}>Daten erfolgreich aktualisiert!</Text>
      <Text style={styles.successSubtitle}>
        Die extrahierten Daten wurden gespeichert und die Vollständigkeit des Objekts erhöht.
      </Text>

      <View style={styles.successStats}>
        <View style={styles.successStat}>
          <Text style={styles.successStatValue}>{analysisResult?.felder_aktualisiert?.length || 0}</Text>
          <Text style={styles.successStatLabel}>Felder aktualisiert</Text>
        </View>
        <View style={styles.successStatDivider} />
        <View style={styles.successStat}>
          <Text style={styles.successStatValue}>{analysisResult?.ki_wissen_count || 0}</Text>
          <Text style={styles.successStatLabel}>KI-Wissen</Text>
        </View>
      </View>

      <View style={styles.successButtons}>
        <TouchableOpacity
          style={styles.successButtonSecondary}
          onPress={() => router.push(`/objekt/${objektId}`)}
        >
          <Feather name="eye" size={18} color="#F97316" />
          <Text style={styles.successButtonSecondaryText}>Objekt ansehen</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.successButtonPrimary}
          onPress={() => {
            setStep('upload');
            setFileName('');
            setFilePreview(null);
            setExtractedData(null);
            setEditedData(null);
            setAnalysisResult(null);
          }}
        >
          <Feather name="plus" size={18} color="#FFFFFF" />
          <Text style={styles.successButtonPrimaryText}>Weiteres Dokument</Text>
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

// Hilfskomponente: Processing Step
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
  uploadContainer: { flexGrow: 1, padding: 24, alignItems: 'center' },
  uploadIcon: { width: 120, height: 120, borderRadius: 30, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  uploadTitle: { fontSize: 24, fontFamily: 'DMSans-Bold', color: '#111827', marginBottom: 8, textAlign: 'center' },
  uploadSubtitle: { fontSize: 15, fontFamily: 'DMSans-Regular', color: '#6B7280', textAlign: 'center', paddingHorizontal: 20, marginBottom: 32, lineHeight: 22 },
  uploadButton: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F97316', paddingHorizontal: 32, paddingVertical: 16, borderRadius: 16 },
  uploadButtonText: { fontSize: 16, fontFamily: 'DMSans-SemiBold', color: '#FFFFFF' },

  // Dokumenttyp
  dokumentTypContainer: { width: '100%', marginBottom: 24 },
  dokumentTypLabel: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#374151', marginBottom: 10 },
  dokumentTypScroll: { flexGrow: 0 },
  dokumentTypButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#F3F4F6', borderRadius: 20, marginRight: 10 },
  dokumentTypButtonActive: { backgroundColor: '#F97316' },
  dokumentTypText: { fontSize: 13, fontFamily: 'DMSans-Medium', color: '#6B7280' },
  dokumentTypTextActive: { color: '#FFFFFF' },

  // Upload Options
  uploadOptions: { flexDirection: 'row', gap: 12, width: '100%', marginBottom: 24 },
  uploadOptionButton: { flex: 1, backgroundColor: '#F9FAFB', borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' },
  uploadOptionIcon: { width: 52, height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  uploadOptionTitle: { fontSize: 14, fontFamily: 'DMSans-SemiBold', color: '#111827' },
  uploadOptionText: { fontSize: 11, fontFamily: 'DMSans-Regular', color: '#6B7280', marginTop: 2 },

  uploadFeatures: { marginTop: 24, width: '100%' },
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
  summaryBanner: { flexDirection: 'row', backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#DBEAFE', alignItems: 'flex-start', gap: 10 },
  summaryText: { flex: 1, fontSize: 13, fontFamily: 'DMSans-Regular', color: '#1E40AF', lineHeight: 20 },
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
