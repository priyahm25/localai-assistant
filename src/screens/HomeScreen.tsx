import { useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '../components/ActionButton';
import { discardPickedFile, extractDocument } from '../services/documentExtractor';
import { selectDocument } from '../services/documentPicker';
import { DocumentExtractionError, type ImportedDocument, type PickedDocument } from '../types/document';
import { logExtractionFailure } from '../services/extractionDiagnostics';
import { DocumentAssistant } from '../components/DocumentAssistant';

export function HomeScreen() {
  const [document, setDocument] = useState<ImportedDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseDocument = async () => {
    let pickedUri: string | undefined;
    let pickedDocument: PickedDocument | undefined;
    const previousDocument = document;
    setError(null);
    setBusy(true);
    try {
      const picked = await selectDocument();
      if (!picked) return;
      pickedDocument = picked;
      pickedUri = picked.uri;
      const extractedText = await extractDocument(picked);
      setDocument({ ...picked, extractedText });
      pickedUri = undefined;
      if (previousDocument) discardPickedFile(previousDocument.uri);
    } catch (reason) {
      if (!pickedDocument) {
        logExtractionFailure(undefined, {
          stage: 'select-document',
          operation: 'expo-document-picker getDocumentAsync',
          error: reason,
          bytesObtained: false,
          byteLength: null,
        });
      }
      setDocument(null);
      if (pickedUri) discardPickedFile(pickedUri);
      if (previousDocument) discardPickedFile(previousDocument.uri);
      setError(reason instanceof DocumentExtractionError ? reason.message : 'The document could not be opened. Try another file.');
    } finally {
      setBusy(false);
    }
  };

  const clearDocument = () => {
    if (document) discardPickedFile(document.uri);
    setDocument(null);
    setError(null);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.eyebrow}>PRIVATE BY DESIGN</Text>
          <Text style={styles.title}>LocalAI Assistant</Text>
          <Text style={styles.subtitle}>Bring in a document to read its text on this device.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Your document</Text>
          <Text style={styles.helper}>TXT, text based PDF, and DOCX files are supported. Scanned PDFs need OCR, which is not included.</Text>
          <ActionButton title="Select a document" onPress={chooseDocument} disabled={busy} />
          {busy && <View style={styles.loading}><ActivityIndicator color="#174E45" /><Text style={styles.helper}>Reading on this device…</Text></View>}
          {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          {document && <View style={styles.fileInfo}>
            <Text style={styles.filename}>{document.name}</Text>
            <Text style={styles.meta}>{document.format.toUpperCase()}{document.size != null ? ` · ${formatSize(document.size)}` : ''}</Text>
          </View>}
        </View>
        {document ? <>
          <DocumentAssistant key={document.uri} documentName={document.name} documentText={document.extractedText} />
          <View style={[styles.card, styles.previewCard]}>
            <Text style={styles.sectionTitle}>Extracted text</Text>
            <Text selectable style={styles.preview}>{document.extractedText}</Text>
            <View style={styles.clearButton}><ActionButton title="Clear document" onPress={clearDocument} secondary /></View>
          </View>
        </> : <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No document selected</Text>
          <Text style={styles.emptyCopy}>Choose a file to see its extracted text here. Your document is not sent to a server.</Text>
        </View>}
        <Text style={styles.footer}>TXT, PDF, and DOCX text extraction stays on this device. Local model analysis requires a custom Android build; web remains available for import and preview.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F8F6' },
  container: { padding: 22, paddingTop: 30, paddingBottom: 40, gap: 16 },
  header: { paddingBottom: 8 },
  eyebrow: { color: '#518077', letterSpacing: 1.8, fontSize: 11, fontWeight: '800', marginBottom: 10 },
  title: { color: '#172C28', fontWeight: '800', fontSize: 30 },
  subtitle: { color: '#657671', fontSize: 15, marginTop: 8, lineHeight: 22 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18, borderWidth: 1, borderColor: '#E5ECE8', gap: 13 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#20332F' },
  helper: { color: '#71807C', lineHeight: 21, fontSize: 14 },
  loading: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingTop: 2 },
  error: { color: '#A0312E', backgroundColor: '#FFF1F0', borderRadius: 10, padding: 12, lineHeight: 20 },
  fileInfo: { borderTopWidth: 1, borderTopColor: '#E8EEEB', paddingTop: 12, gap: 4 },
  filename: { color: '#233A34', fontSize: 15, fontWeight: '700' },
  meta: { color: '#788781', fontSize: 12, letterSpacing: 0.5 },
  previewCard: { gap: 12 },
  preview: { color: '#35443F', fontSize: 15, lineHeight: 23 },
  clearButton: { paddingTop: 4 },
  empty: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 23 },
  emptyTitle: { color: '#52655E', fontSize: 16, fontWeight: '700' },
  emptyCopy: { color: '#82908A', fontSize: 14, textAlign: 'center', lineHeight: 21, marginTop: 6 },
  footer: { color: '#87938F', fontSize: 12, textAlign: 'center', lineHeight: 18, paddingHorizontal: 10 },
});
