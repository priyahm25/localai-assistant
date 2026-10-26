import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAnalysisChunkBudget,
  chunkDocument,
  chunkDocumentForSummary,
  createStreamingOutputInspector,
  ensureDocumentText,
  inspectAccumulatedOutput,
  shouldActivateModel,
  summaryInferenceCallCount,
  stripModelThinking,
  MAX_ANALYSIS_CHUNKS,
  MAX_SINGLE_CALL_SUMMARY_CHARACTERS,
} from '../src/services/documentAnalysis';

test('summary input rejects empty text and invalid chunk limits', () => {
  assert.throws(() => ensureDocumentText('   '), /no extracted text/i);
  assert.throws(() => ensureDocumentText(null as unknown as string), /no extracted text/i);
  assert.throws(() => chunkDocument('some text', 10), /chunk limit/i);
});

test('chunking preserves source content and explicit page locations', () => {
  const text = '[Page 3]\n' + 'A'.repeat(150) + '\n' + 'B'.repeat(150);
  const chunks = chunkDocument(text, 120);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 120));
  assert.ok(chunks.every((chunk) => chunk.location.includes('page 3')));
  assert.equal(chunks.map((chunk) => chunk.text).join('').replace(/\s/g, ''), text.replace(/^\[Page 3\]\s*/i, '').replace(/\s/g, ''));
  assert.ok(chunks[0].start < chunks.at(-1)!.end);
});

test('chunking labels sections when page metadata is unavailable', () => {
  const chunks = chunkDocument('Heading:\nFirst passage.\n\nSecond passage.', 100);
  assert.ok(chunks.every((chunk) => /^section \d+$/.test(chunk.location)));
});

test('five-page documents retain every page through bounded summary chunks', () => {
  const text = Array.from({ length: 5 }, (_, index) => `[Page ${index + 1}]\n${String.fromCharCode(65 + index).repeat(600)}`).join('\n');
  const chunks = chunkDocumentForSummary(text);
  assert.ok(chunks.length >= 5);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 700));
  for (let index = 0; index < 5; index += 1) {
    assert.ok(chunks.some((chunk) => chunk.text.includes(String.fromCharCode(65 + index).repeat(100))));
    assert.ok(chunks.some((chunk) => chunk.location.includes(`page ${index + 1}`)));
  }
  assert.doesNotThrow(() => assertAnalysisChunkBudget(chunks));
  assert.ok(summaryInferenceCallCount(chunks.length) > chunks.length);
});

test('the full summary budget rejects an oversized document without skipping sections', () => {
  const oversized = chunkDocument(Array.from({ length: MAX_ANALYSIS_CHUNKS + 1 }, () => 'B'.repeat(650)).join('\n\n'));
  assert.equal(oversized.length, MAX_ANALYSIS_CHUNKS + 1);
  assert.throws(() => assertAnalysisChunkBudget(oversized), /too large for complete on-device summarization.*no sections were skipped/i);
});

test('model activation is skipped only when the requested model is already active', () => {
  assert.equal(shouldActivateModel('qwen3-0.6b', 'qwen3-0.6b'), false);
  assert.equal(shouldActivateModel(undefined, 'qwen3-0.6b'), true);
  assert.equal(shouldActivateModel('other-model', 'qwen3-0.6b'), true);
});

test('short page-marked text stays complete in one model input', () => {
  const text = `[Page 1]\nHeading:\n${'A'.repeat(MAX_SINGLE_CALL_SUMMARY_CHARACTERS - 20)}`;
  const chunks = chunkDocumentForSummary(text);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, text);
  assert.equal(summaryInferenceCallCount(chunks.length), 1);
});

test('long summary inputs retain bounded chunks', () => {
  const chunks = chunkDocumentForSummary('X'.repeat(MAX_SINGLE_CALL_SUMMARY_CHARACTERS + 1));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 700));
});

test('short model output stays under the visible character limit', () => {
  assert.deepEqual(inspectAccumulatedOutput('Hello.', 120), {
    rawCharacters: 6, visibleCharacters: 6, excessive: false,
  });
});

test('reasoning tags split across stream events are excluded from visible output count', () => {
  const inspect = createStreamingOutputInspector(20);
  const chunks = ['<thi', 'nk>private reasoning', ' more</think>Hel', 'lo.'];
  let result = inspect('');
  for (const chunk of chunks) result = inspect(chunk);
  assert.deepEqual(stripModelThinking(chunks.join('')), { text: 'Hello.', reasoning: 'private reasoning more' });
  assert.equal(result.visibleCharacters, 6);
  assert.equal(result.excessive, false);
});

test('stream output guard bounds both visible summaries and raw reasoning', () => {
  const visible = createStreamingOutputInspector(20);
  assert.equal(visible('A'.repeat(21)).excessive, true);
  const reasoning = createStreamingOutputInspector(20, 100);
  assert.equal(reasoning(`<think>${'x'.repeat(101)}</think>`).excessive, true);
});
