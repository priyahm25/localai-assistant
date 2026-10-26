import { Platform } from 'react-native';
import {
  assertAnalysisChunkBudget,
  chunkDocumentForSummary,
  createStreamingOutputInspector,
  ensureDocumentText,
  logChunkMetrics,
  shouldActivateModel,
  summaryInferenceCallCount,
  stripModelThinking,
} from './documentAnalysis';
import { runSummaryPipeline } from './summaryPipeline';
import { DEFAULT_LOCAL_AI_MODEL, LOCAL_AI_MODELS, registerGemma3Model, type LocalAiModelId } from './localAiModels';
import { logPerformance } from './performanceDiagnostics';

export type AiProgress = (message: string, progress?: number) => void;
export interface AnalysisResult { text: string; examinedChunks: number; totalChunks: number; complete: boolean }
type AiKit = typeof import('expo-ai-kit');

let kitPromise: Promise<AiKit> | undefined;
let downloadPromise: Promise<void> | undefined;
let activeStream: { stop: () => void } | undefined;
let modelActivationPromise: Promise<void> | undefined;
let generationInFlight = false;
let inferenceCancellationVersion = 0;

async function kit(): Promise<AiKit> {
  assertNativeAndroid();
  if (!kitPromise) {
    kitPromise = import('expo-ai-kit').then((ai) => {
      registerGemma3Model(ai.registerModel, ai.getRegisteredModels);
      return ai;
    }).catch((error) => {
      kitPromise = undefined;
      throw error;
    });
  }
  return kitPromise;
}

function assertNativeAndroid(): void {
  if (Platform.OS !== 'android') {
    throw new Error('On-device document summarization requires the Android native build. Document import and extraction remain available on web.');
  }
}

async function ensureModelActive(ai: AiKit, modelId: LocalAiModelId): Promise<void> {
  if (!shouldActivateModel(ai.getActiveModel(), modelId)) return;
  if (modelActivationPromise) {
    await modelActivationPromise;
    if (!shouldActivateModel(ai.getActiveModel(), modelId)) return;
  }
  if (!shouldActivateModel(ai.getActiveModel(), modelId)) return;
  console.info('[local-ai:prepare-start]', { operation: 'model-activation', modelId });
  const startedAt = Date.now();
  modelActivationPromise = ai.setModel(modelId, { backend: 'cpu', generation: { temperature: 0.2, topK: 40 } });
  try {
    await modelActivationPromise;
    console.info('[local-ai:prepare-complete]', { operation: 'model-activation', modelId, durationMs: Date.now() - startedAt });
  } catch (error) {
    console.error('[local-ai:prepare-error]', { operation: 'model-activation', modelId, ...errorMetadata(error) });
    throw error;
  } finally {
    modelActivationPromise = undefined;
  }
}

export async function getModelState(modelId: LocalAiModelId = DEFAULT_LOCAL_AI_MODEL): Promise<{ installed: boolean; ready: boolean; compatible: boolean }> {
  if (Platform.OS !== 'android') return { installed: false, ready: false, compatible: false };
  const ai = await kit();
  const model = (await ai.getDownloadableModels()).find((item) => item.id === modelId);
  return {
    installed: Boolean(model && ['downloaded', 'ready', 'loading'].includes(model.status)),
    ready: model?.status === 'ready' || ai.getActiveModel() === modelId,
    compatible: Boolean(model?.meetsRequirements),
  };
}

export async function prepareModel(onProgress: AiProgress, modelId: LocalAiModelId = DEFAULT_LOCAL_AI_MODEL): Promise<void> {
  assertNativeAndroid();
  if (downloadPromise) return downloadPromise;
  console.info('[local-ai:prepare-start]', { operation: 'model-preparation', modelId });
  downloadPromise = (async () => {
    const ai = await kit();
    const modelConfig = LOCAL_AI_MODELS[modelId];
    const model = (await ai.getDownloadableModels()).find((item) => item.id === modelId);
    if (!model) throw new Error(`${modelConfig.name} is missing from the installed Expo AI Kit model catalog.`);
    if (!model.meetsRequirements) throw new Error('This device does not meet the model’s minimum memory requirement.');
    if (model.status !== 'downloaded' && model.status !== 'ready' && model.status !== 'loading') {
      onProgress(`Downloading ${modelConfig.name} (${modelConfig.sizeLabel}). This download is required once.`, 0);
      await ai.downloadModel(modelId, { onProgress: (progress) => onProgress(`Downloading ${modelConfig.name}…`, progress) });
    }
    if (shouldActivateModel(ai.getActiveModel(), modelId)) {
      onProgress(`Loading ${modelConfig.name} on this device…`);
      await ensureModelActive(ai, modelId);
    }
    onProgress(`${modelConfig.name} is ready on this device.`, 1);
    console.info('[local-ai:prepare-complete]', { operation: 'model-preparation', modelId });
  })().finally(() => { downloadPromise = undefined; });
  try {
    await downloadPromise;
  } catch (error) {
    console.error('[local-ai:prepare-error]', { operation: 'model-preparation', modelId, ...errorMetadata(error) });
    throw error;
  }
}

export async function cancelModelDownload(modelId: LocalAiModelId = DEFAULT_LOCAL_AI_MODEL): Promise<void> {
  if (Platform.OS !== 'android') return;
  const ai = await kit();
  await ai.cancelDownload(modelId);
}

export async function cancelInference(): Promise<void> {
  inferenceCancellationVersion += 1;
  activeStream?.stop();
  activeStream = undefined;
}

/** Uses Expo AI Kit's documented unload operation when the selected document screen closes. */
export async function unloadModel(modelId: LocalAiModelId = DEFAULT_LOCAL_AI_MODEL): Promise<void> {
  if (Platform.OS !== 'android') return;
  const ai = await kit();
  if (ai.getActiveModel() === modelId) await ai.unloadModel();
}

export async function summarizeDocument(documentText: string, onProgress: AiProgress, modelId: LocalAiModelId = DEFAULT_LOCAL_AI_MODEL): Promise<AnalysisResult> {
  ensureDocumentText(documentText);
  const startedAt = Date.now();
  const chunks = chunkDocumentForSummary(documentText);
  assertAnalysisChunkBudget(chunks);
  logChunkMetrics(documentText, chunks);
  let modelCalls = 0;
  let succeeded = false;
  try {
    // Import and activate once per summary, then reuse this runtime for every
    // source and combine section. No model initialization occurs per chunk.
    const ai = await kit();
    console.info('[local-ai:prepare-start]', { operation: 'summary-model-ready', modelId });
    await ensureModelActive(ai, modelId);
    console.info('[local-ai:prepare-complete]', { operation: 'summary-model-ready', modelId, durationMs: Date.now() - startedAt });
    const summary = await runSummaryPipeline(
      chunks,
      onProgress,
      (prompt, limit, task, onFirstOutput) => generate(ai, prompt, limit, task, onFirstOutput),
      () => { modelCalls += 1; },
    );
    succeeded = true;
    return { text: summary, examinedChunks: chunks.length, totalChunks: chunks.length, complete: true };
  } catch (error) {
    console.error('[local-ai:summary-error]', { sourceSectionCount: chunks.length, modelCalls, ...errorMetadata(error) });
    throw error;
  } finally {
    if (__DEV__) console.debug('[local-ai:task-timing]', {
      task: 'summary',
      sourceSectionCount: chunks.length,
      modelCalls,
      plannedModelCalls: summaryInferenceCallCount(chunks.length),
      durationMs: Date.now() - startedAt,
      success: succeeded,
    });
  }
}

async function generate(
  ai: AiKit,
  prompt: string,
  responseCharacterLimit: number,
  task: string,
  onFirstOutput?: () => void,
): Promise<string> {
  const modelId = ai.getActiveModel() as LocalAiModelId;
  if (![2_048, 4_096].includes(LOCAL_AI_MODELS[modelId]?.contextWindow)) {
    throw new Error('The configured local model context changed; review document budgets.');
  }
  if (generationInFlight) throw new Error('Another on-device inference is already running. Wait for it to finish, then retry.');
  const cancellationVersion = inferenceCancellationVersion;
  const startedAt = Date.now();
  let firstOutputAt: number | null = null;
  let firstVisibleAt: number | null = null;
  let finalRawCharacters = 0;
  let finalVisibleCharacters = 0;
  let hitLimit = false;
  let generationCompleted = false;
  let generationSucceeded = false;
  let tokenEvents = 0;
  let terminalEventSeen = false;
  const inspectToken = createStreamingOutputInspector(responseCharacterLimit);
  console.info('[local-ai:generation-start]', { task, modelId, responseCharacterLimit });
  generationInFlight = true;
  let stream: ReturnType<typeof ai.streamMessage> | undefined;
  try {
    const currentStream = ai.streamMessage([{ role: 'user', content: prompt }], (event) => {
      tokenEvents += 1;
      const lengths = inspectToken(event.token);
      finalRawCharacters = lengths.rawCharacters;
      finalVisibleCharacters = lengths.visibleCharacters;
      if (event.token.length > 0 && firstOutputAt === null) {
        firstOutputAt = Date.now();
        onFirstOutput?.();
      }
      if (event.isDone) {
        terminalEventSeen = true;
        console.info('[local-ai:stream-terminal]', { task, tokenEvents, rawCharacters: lengths.rawCharacters });
      }
      if (lengths.visibleCharacters > 0 && firstVisibleAt === null) firstVisibleAt = Date.now();
      if (lengths.excessive) {
        hitLimit = true;
        currentStream.stop();
      }
    });
    stream = currentStream;
    activeStream = currentStream;
    const result = await currentStream.promise.then((value) => value.text);
    generationCompleted = true;
    if (cancellationVersion !== inferenceCancellationVersion) throw new Error('Summary cancelled. You can retry when ready.');
    if (hitLimit) throw new Error('The local model response exceeded its safe length. Retry with a shorter document section.');
    finalRawCharacters = result.length;
    finalVisibleCharacters = stripModelThinking(result).text.length;
    const trimmed = stripModelThinking(result).text.trim();
    if (!trimmed) throw new Error('The local model returned an empty response. Retry the summary.');
    generationSucceeded = true;
    console.info('[local-ai:generation-complete]', { task, durationMs: Date.now() - startedAt, tokenEvents, terminalEventSeen, rawCharacters: finalRawCharacters, visibleCharacters: finalVisibleCharacters });
    return trimmed;
  } catch (error) {
    console.error('[local-ai:generation-error]', { task, durationMs: Date.now() - startedAt, tokenEvents, terminalEventSeen, ...errorMetadata(error) });
    throw error;
  } finally {
    logPerformance('model-inference', { durationMs: Date.now() - startedAt, success: generationSucceeded });
    if (__DEV__) console.debug('[local-ai:timing]', {
      task,
      durationMs: Date.now() - startedAt,
      timeToFirstOutputMs: firstOutputAt === null ? null : firstOutputAt - startedAt,
      timeToFirstVisibleOutputMs: firstVisibleAt === null ? null : firstVisibleAt - startedAt,
      rawCharacters: finalRawCharacters,
      visibleCharacters: finalVisibleCharacters,
      completed: generationCompleted && !hitLimit,
      stoppedForLength: hitLimit,
    });
    if (activeStream === stream) activeStream = undefined;
    generationInFlight = false;
  }
}

function errorMetadata(error: unknown): { errorName: string; errorCode?: string } {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    return { errorName: error.name, ...(code ? { errorCode: code } : {}) };
  }
  return { errorName: typeof error };
}
