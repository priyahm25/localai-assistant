import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from './ActionButton';
import {
  cancelInference,
  cancelModelDownload,
  getModelState,
  prepareModel,
  summarizeDocument,
  unloadModel,
  type AiProgress,
} from '../services/localAiService';
import { DEFAULT_LOCAL_AI_MODEL, LOCAL_AI_MODELS, type LocalAiModelId } from '../services/localAiModels';
import { logPerformance } from '../services/performanceDiagnostics';
import { createAsyncSingleFlight } from '../services/asyncSingleFlight';

interface Props { documentName: string; documentText: string }

export function DocumentAssistant({ documentName, documentText }: Props) {
  const [selectedModel, setSelectedModel] = useState<LocalAiModelId>(DEFAULT_LOCAL_AI_MODEL);
  const [modelReady, setModelReady] = useState(false);
  const [modelInstalled, setModelInstalled] = useState(false);
  const [compatible, setCompatible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const runFlight = useRef<ReturnType<typeof createAsyncSingleFlight<void>> | null>(null);
  const summaryStartedAt = useRef<number | null>(null);
  const busyRef = useRef(false);
  if (runFlight.current === null) runFlight.current = createAsyncSingleFlight<void>();

  useEffect(() => {
    if (summary !== null && summaryStartedAt.current !== null) {
      logPerformance('summary-tap-to-display', { durationMs: Date.now() - summaryStartedAt.current, success: true });
      summaryStartedAt.current = null;
    }
  }, [summary]);

  const refresh = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      const state = await getModelState(selectedModel);
      setModelInstalled(state.installed);
      setModelReady(state.ready);
      setCompatible(state.compatible);
    } catch {
      setError('Local AI needs the custom Android development build. This feature is unavailable in Expo Go.');
    }
  }, [selectedModel]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => () => {
    // Expo AI Kit documents unloadModel() as the way to release the active
    // downloadable model. Keep it loaded while this document is in use or
    // while native inference is still running.
    if (!busyRef.current) void unloadModel(selectedModel);
  }, [selectedModel]);

  const runSummary = () => runFlight.current!.run(async () => {
    const startedAt = Date.now();
    summaryStartedAt.current = startedAt;
    let succeeded = false;
    let downloadStartedAt: number | undefined;
    let loadStartedAt: number | undefined;
    let preparationSucceeded = false;
    const preparationStartedAt = Date.now();
    setRetryAction(() => () => { void runSummary(); });
    setBusy(true);
    busyRef.current = true;
    setError(null);
    setSummary(null);
    setProgress('Preparing the on-device model…');
    setDownloadProgress(undefined);
    try {
      await prepareModel((message, value) => {
        if (message.startsWith('Downloading') && downloadStartedAt === undefined) downloadStartedAt = Date.now();
        if (message.startsWith('Loading') && loadStartedAt === undefined) {
          if (downloadStartedAt !== undefined) {
            logPerformance('model-download', { durationMs: Date.now() - downloadStartedAt, success: true });
            downloadStartedAt = undefined;
          }
          loadStartedAt = Date.now();
        }
        if (message.includes('is ready on this device.') && loadStartedAt !== undefined) {
          logPerformance('model-load', { durationMs: Date.now() - loadStartedAt, success: true });
          loadStartedAt = undefined;
        }
        setProgress(message);
        if (value !== undefined) setDownloadProgress(value);
      }, selectedModel);
      preparationSucceeded = true;
      setModelInstalled(true);
      setModelReady(true);
      const result = await summarizeDocument(documentText, setProgress, selectedModel);
      setSummary(result.text);
      succeeded = true;
    } catch (reason) {
      console.error('[local-ai:ui-summary-error]', {
        errorName: reason instanceof Error ? reason.name : typeof reason,
        errorCode: reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string' ? reason.code : undefined,
      });
      setError(describeError(reason));
    } finally {
      if (downloadStartedAt !== undefined) logPerformance('model-download', { durationMs: Date.now() - downloadStartedAt, success: false });
      if (loadStartedAt !== undefined) logPerformance('model-load', { durationMs: Date.now() - loadStartedAt, success: false });
      logPerformance('model-preparation', { durationMs: Date.now() - preparationStartedAt, success: preparationSucceeded });
      logPerformance('summary-total', { durationMs: Date.now() - startedAt, success: succeeded });
      if (!succeeded && summaryStartedAt.current !== null) {
        logPerformance('summary-tap-to-display', { durationMs: Date.now() - summaryStartedAt.current, success: false });
        summaryStartedAt.current = null;
      }
      setBusy(false);
      busyRef.current = false;
      setProgress('');
      void refresh();
    }
  });

  const selectModel = (modelId: LocalAiModelId) => {
    if (busy || modelId === selectedModel) return;
    setSelectedModel(modelId);
    setModelReady(false);
    setModelInstalled(false);
    setCompatible(true);
    setDownloadProgress(undefined);
    setSummary(null);
    setError(null);
  };

  const onDevice = Platform.OS === 'android';
  const notAvailableMessage = Platform.OS === 'web'
    ? 'Document import and extraction work on web. Local summarization requires the Android native build.'
    : 'Install the custom Android development build to use local AI. Expo Go does not contain the model runtime.';

  return <View style={styles.card}>
    <Text style={styles.heading}>Summarize document</Text>
    <Text style={styles.privacy}>On-device only. Document text is not sent to an inference service.</Text>
    <Text style={styles.selected}>Selected: {documentName}</Text>
    {onDevice && <View style={styles.stack}>
      <Text style={styles.helper}>Local model</Text>
      <View style={styles.row}>
        <ActionButton title="Qwen3 0.6B" secondary={selectedModel !== 'qwen3-0.6b'} onPress={() => selectModel('qwen3-0.6b')} disabled={busy} />
        <ActionButton title="Gemma 3 1B" secondary={selectedModel !== 'gemma3-1b-it'} onPress={() => selectModel('gemma3-1b-it')} disabled={busy} />
      </View>
      <Text style={styles.helper}>{LOCAL_AI_MODELS[selectedModel].name} · {LOCAL_AI_MODELS[selectedModel].sizeLabel}. The selected model runs offline.</Text>
      {!compatible && <Text style={styles.error}>This device does not meet the model’s minimum memory requirement.</Text>}
    </View>}
    {!onDevice && <Text style={styles.helper}>{notAvailableMessage}</Text>}
    <ActionButton title={busy ? 'Summarizing…' : 'Summarize'} onPress={runSummary} disabled={busy || !onDevice || !compatible} />
    {onDevice && !modelReady && <Text style={styles.helper}>{modelInstalled ? 'The downloaded model will load when you summarize.' : 'The selected model downloads once and loads when you summarize.'}</Text>}
    {busy && <View style={styles.progress}><ActivityIndicator color="#174E45" /><Text style={styles.helper}>{progress}</Text></View>}
    {typeof downloadProgress === 'number' && !modelReady && <Text style={styles.helper}>Download progress: {Math.round(downloadProgress * 100)}%</Text>}
    {busy && progress.toLowerCase().includes('downloading') && <ActionButton title="Cancel download" secondary onPress={() => { void cancelModelDownload(selectedModel); setProgress('Cancelling download…'); }} />}
    {busy && !progress.toLowerCase().includes('downloading') && modelReady && <ActionButton title="Cancel summary" secondary onPress={() => { void cancelInference(); setProgress('Cancelling summary…'); }} />}
    {error && <View style={styles.stack}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><ActionButton title="Retry summary" secondary onPress={() => { setError(null); if (retryAction) retryAction(); else void refresh(); }} /></View>}
    {summary !== null && <View style={styles.result}>
      <Text style={styles.resultTitle}>Summary</Text>
      <Text selectable style={styles.body}>{summary}</Text>
    </View>}
  </View>;
}

function describeError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/Exponent|native module|ExpoAiKit|not available/i.test(message)) return 'Local AI needs the custom Android development build. Rebuild after installing the native AI package.';
  if (/cancel/i.test(message)) return 'The summary was cancelled. You can retry when ready.';
  return `${message} You can retry the summary.`;
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
  result: { borderTopWidth: 1, borderTopColor: '#E8EEEB', paddingTop: 12, gap: 9 },
  resultTitle: { color: '#20332F', fontWeight: '700', fontSize: 16 },
  body: { color: '#35443F', fontSize: 14, lineHeight: 21 },
});
