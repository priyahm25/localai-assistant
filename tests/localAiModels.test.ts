import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LOCAL_AI_MODEL,
  GEMMA3_MODEL_REGISTRY_ENTRY,
  LOCAL_AI_MODELS,
  registerGemma3Model,
} from '../src/services/localAiModels';

test('Gemma is a separate selectable model and Qwen remains the default', () => {
  assert.equal(DEFAULT_LOCAL_AI_MODEL, 'qwen3-0.6b');
  assert.equal(LOCAL_AI_MODELS['qwen3-0.6b'].contextWindow, 2_048);
  assert.equal(LOCAL_AI_MODELS['gemma3-1b-it'].contextWindow, 4_096);
  assert.equal(GEMMA3_MODEL_REGISTRY_ENTRY.id, 'gemma3-1b-it');
  assert.equal(GEMMA3_MODEL_REGISTRY_ENTRY.downloadUrl.endsWith('/gemma3-1b-it-int4.litertlm'), true);
  assert.equal(GEMMA3_MODEL_REGISTRY_ENTRY.sha256, '1325ae366d31950f137c9c357b9fa89448b176d76998180c08ceaca78bba98be');
  assert.equal(GEMMA3_MODEL_REGISTRY_ENTRY.sizeBytes, 584_417_280);
  assert.deepEqual(GEMMA3_MODEL_REGISTRY_ENTRY.supportedPlatforms, ['android']);
  assert.equal(GEMMA3_MODEL_REGISTRY_ENTRY.license, 'Gemma');
});

test('Gemma registration is idempotent across repeated model service access', () => {
  const entries: Array<{ id: string }> = [];
  const register = (entry: { id: string }) => { entries.push(entry); };
  const getRegistered = () => entries;

  registerGemma3Model(register, getRegistered);
  registerGemma3Model(register, getRegistered);

  assert.deepEqual(entries.map((entry) => entry.id), ['gemma3-1b-it']);
});
