import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionButton } from './ActionButton';
import {
  answerDocumentQuestion,
  cancelInference,
  cancelModelDownload,
  extractImportantPoints,
  findDeadlines,
  getModelState,
  prepareModel,
  summarizeDocument,
  type AiProgress,
} from '../services/localAiService';
import type { ValidatedDeadline } from '../services/documentAnalysis';

interface Props { documentName: string; documentText: string }
type Result = { title: string; text?: string; deadlines?: ValidatedDeadline[]; note?: string };

export function DocumentAssistant({ documentName, documentText }: Props) {
  const [modelReady, setModelReady] = useState(false);
  const [modelInstalled, setModelInstalled] = useState(false);
  const [compatible, setCompatible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [question, setQuestion] = useState('');
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      const state = await getModelState();
      setModelInstalled(state.installed);
      setModelReady(state.ready);
      setCompatible(state.compatible);
    } catch {
      setError('Local AI needs the custom Android development build. This feature is unavailable in Expo Go.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const prepare = async () => {
    setRetryAction(() => () => { void prepare(); });
    setError(null);
    setBusy(true);
    setProgress('Preparing model…');
    try {
      await prepareModel((message, value) => {
        setProgress(message);
        if (value !== undefined) setDownloadProgress(value);
      });
      setModelInstalled(true);
      setModelReady(true);
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const run = async (title: string, task: (onProgress: AiProgress) => Promise<{ text: string; complete: boolean; examinedChunks: number; totalChunks: number; deadlines?: ValidatedDeadline[] }>) => {
    setRetryAction(() => () => { void run(title, task); });
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress('Analyzing on this device…');
    try {
      const value = await task((message) => setProgress(message));
      setResult({
        title,
        text: value.text,
        deadlines: value.deadlines,
        note: value.complete
          ? `Reviewed ${value.examinedChunks} of ${value.totalChunks} text sections.`
          : `Reviewed ${value.examinedChunks} relevant sections of ${value.totalChunks}; this is not a full-document review.`,
      });
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const onDevice = Platform.OS === 'android';
  const notAvailableMessage = Platform.OS === 'web'
    ? 'Document import and preview work on web. Local model inference requires the Android native build.'
    : 'Install the custom Android development build to use local AI. Expo Go does not contain the model runtime.';

  return <View style={styles.card}>
    <Text style={styles.heading}>Document assistant</Text>
    <Text style={styles.privacy}>On-device analysis · document text and questions are not sent to an inference service.</Text>
    <Text style={styles.selected}>Selected: {documentName}</Text>
    {onDevice && !modelReady && <View style={styles.stack}>
      <Text style={styles.helper}>{modelInstalled ? 'Qwen3-0.6B is downloaded and needs loading.' : 'Download Qwen3-0.6B once (about 475 MB), then analyze offline.'}</Text>
      {!compatible && <Text style={styles.error}>This device does not meet the model’s minimum memory requirement.</Text>}
      <ActionButton title={busy ? 'Preparing model…' : modelInstalled ? 'Load local model' : 'Download and load model'} onPress={prepare} disabled={busy || !compatible} />
      {busy && !modelReady && <ActionButton title="Cancel download" secondary onPress={() => { void cancelModelDownload(); setBusy(false); setProgress('Download cancelled.'); }} />}
    </View>}
    {!onDevice && <Text style={styles.helper}>{notAvailableMessage}</Text>}
    {modelReady && <View style={styles.stack}>
      <View style={styles.row}>
        <ActionButton title="Summarize" onPress={() => void run('Summary', (cb) => summarizeDocument(documentText, cb))} disabled={busy} />
        <ActionButton title="Important points" onPress={() => void run('Important points', (cb) => extractImportantPoints(documentText, cb))} disabled={busy} />
      </View>
      <ActionButton title="Find deadlines" secondary onPress={() => void run('Deadlines and submission requirements', async (cb) => {
        const value = await findDeadlines(documentText, cb);
        return { ...value, text: '', deadlines: value.deadlines };
      })} disabled={busy} />
      <TextInput value={question} onChangeText={setQuestion} placeholder="Ask about this document" placeholderTextColor="#82908A" style={styles.input} editable={!busy} multiline />
      <ActionButton title="Ask question" onPress={() => void run('Answer', (cb) => answerDocumentQuestion(documentText, question, cb))} disabled={busy || !question.trim()} />
    </View>}
    {busy && <View style={styles.progress}><ActivityIndicator color="#174E45" /><Text style={styles.helper}>{progress}</Text></View>}
    {typeof downloadProgress === 'number' && !modelReady && <Text style={styles.helper}>Download progress: {Math.round(downloadProgress * 100)}%</Text>}
    {busy && modelReady && <ActionButton title="Cancel analysis" secondary onPress={() => { void cancelInference(); setBusy(false); setProgress('Analysis cancelled.'); }} />}
    {error && <View style={styles.stack}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><ActionButton title="Retry" secondary onPress={() => { setError(null); if (retryAction) retryAction(); else void refresh(); }} /></View>}
    {result && <View style={styles.result}>
      <Text style={styles.resultTitle}>{result.title}</Text>
      {result.text ? <Text selectable style={styles.body}>{result.text}</Text> : null}
      {result.deadlines?.length ? result.deadlines.map((item, index) => <View key={`${item.location}-${index}`} style={styles.deadline}>
        <Text style={styles.body}>{item.dateText} · {item.requirement}</Text>
        <Text style={styles.helper}>{item.kind === 'explicit' ? 'Explicitly stated' : 'Inferred'} · {item.location}</Text>
        <Text selectable style={styles.evidence}>“{item.evidence}”</Text>
      </View>) : result.deadlines ? <Text style={styles.body}>No deadline was found in the reviewed text.</Text> : null}
      {result.note && <Text style={styles.helper}>{result.note}</Text>}
    </View>}
  </View>;
}

function describeError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/Exponent|native module|ExpoAiKit|not available/i.test(message)) return 'Local AI needs the custom Android development build. Rebuild after installing the native AI package.';
  if (/cancel/i.test(message)) return 'The operation was cancelled. You can retry when ready.';
  return `${message} You can retry the action.`;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18, borderWidth: 1, borderColor: '#DCE9E3', gap: 12 },
  heading: { color: '#20332F', fontSize: 19, fontWeight: '800' },
  privacy: { color: '#397267', fontSize: 13, lineHeight: 19 },
  selected: { color: '#52655E', fontSize: 13 },
  helper: { color: '#71807C', fontSize: 13, lineHeight: 19, flexShrink: 1 },
  stack: { gap: 10 },
  row: { flexDirection: 'row', gap: 8 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  error: { color: '#A0312E', backgroundColor: '#FFF1F0', borderRadius: 10, padding: 11, lineHeight: 19 },
  input: { borderWidth: 1, borderColor: '#DCE5E0', borderRadius: 10, padding: 11, minHeight: 46, color: '#263A34' },
  result: { borderTopWidth: 1, borderTopColor: '#E8EEEB', paddingTop: 12, gap: 9 },
  resultTitle: { color: '#20332F', fontWeight: '700', fontSize: 16 },
  body: { color: '#35443F', fontSize: 14, lineHeight: 21 },
  deadline: { gap: 4, borderLeftWidth: 3, borderLeftColor: '#78A89A', paddingLeft: 10 },
  evidence: { color: '#53635D', fontSize: 13, lineHeight: 19 },
});
