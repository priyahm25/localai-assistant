import type { ModelRegistryEntry } from 'expo-ai-kit';

export type LocalAiModelId = 'qwen3-0.6b' | 'gemma3-1b-it';

export const DEFAULT_LOCAL_AI_MODEL: LocalAiModelId = 'qwen3-0.6b';

export const LOCAL_AI_MODELS: Record<LocalAiModelId, {
  id: LocalAiModelId;
  name: string;
  sizeLabel: string;
  contextWindow: number;
}> = {
  'qwen3-0.6b': {
    id: 'qwen3-0.6b',
    name: 'Qwen3 0.6B',
    sizeLabel: 'about 475 MB',
    contextWindow: 2_048,
  },
  'gemma3-1b-it': {
    id: 'gemma3-1b-it',
    name: 'Gemma 3 1B Instruct',
    sizeLabel: 'about 584 MB',
    contextWindow: 4_096,
  },
};

/**
 * Google AI Edge Gallery's LiteRT-LM 1.0.10 allowlist pins this artifact to
 * upstream revision 42d538a932e8d5b12e6b3b455f5572560bd60b2c. The upstream
 * repository is gated; Expo AI Kit's downloader accepts a URL and SHA-256 but
 * no auth header. This public mirror advertises the same source artifact, and
 * the native downloader verifies every downloaded byte against the pinned hash.
 */
export const GEMMA3_MODEL_REGISTRY_ENTRY: ModelRegistryEntry = {
  id: 'gemma3-1b-it',
  name: 'Gemma 3 1B Instruct',
  parameterCount: '1B',
  quantization: 'int4',
  downloadUrl:
    'https://huggingface.co/moonlauncher/moon-models/resolve/main/gemma/gemma3-1b-it-int4.litertlm',
  sha256: '1325ae366d31950f137c9c357b9fa89448b176d76998180c08ceaca78bba98be',
  sizeBytes: 584_417_280,
  contextWindow: 4_096,
  minRamBytes: 6_000_000_000,
  supportedPlatforms: ['android'],
  license: 'Gemma',
  preferredBackend: 'cpu',
};

export function registerGemma3Model(
  register: (entry: ModelRegistryEntry) => void,
  getRegistered: () => readonly Pick<ModelRegistryEntry, 'id'>[],
): void {
  if (getRegistered().some((model) => model.id === GEMMA3_MODEL_REGISTRY_ENTRY.id)) return;
  register(GEMMA3_MODEL_REGISTRY_ENTRY);
}
