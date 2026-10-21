import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkDocument, ensureDocumentText, parseDeadlineJson, rankRelevantChunks } from '../src/services/documentAnalysis';

test('analysis rejects empty and malformed input instead of reporting no deadline', () => {
  assert.throws(() => ensureDocumentText('   '), /no extracted text/i);
  assert.throws(() => ensureDocumentText(null as unknown as string), /no extracted text/i);
  assert.throws(() => chunkDocument('some text', 10), /chunk limit/i);
});

test('chunking stays bounded and preserves every character and explicit page location', () => {
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

test('local lexical retrieval selects matching passages and returns none on no match', () => {
  const chunks = chunkDocument('Payment is due by 15 June.\n\nThe venue is the north hall.');
  assert.equal(rankRelevantChunks(chunks, 'When is payment due?')[0]?.text, 'Payment is due by 15 June.');
  assert.deepEqual(rankRelevantChunks(chunks, 'What is the mascot?'), []);
});

test('deadline output accepts verbatim explicit evidence and attaches source location', () => {
  const chunk = chunkDocument('Submit the signed form by 15 June 2027.', 100)[0];
  const result = parseDeadlineJson('{"deadlines":[{"dateText":"15 June 2027","requirement":"Submit the signed form","evidence":"Submit the signed form by 15 June 2027.","kind":"explicit"}]}', chunk);
  assert.equal(result[0].kind, 'explicit');
  assert.equal(result[0].location, 'section 1');
  assert.equal(result[0].evidence, 'Submit the signed form by 15 June 2027.');
});

test('deadline output supports an empty result only as a valid analyzed-chunk response', () => {
  assert.deepEqual(parseDeadlineJson('{"deadlines":[]}', chunkDocument('No date appears in this passage.')[0]), []);
});

test('deadline validator rejects malformed JSON, missing fields, and invented evidence for retry', () => {
  const chunk = chunkDocument('The application is due 10 July.')[0];
  assert.throws(() => parseDeadlineJson('not json', chunk), /valid JSON.*Retry/i);
  assert.throws(() => parseDeadlineJson('{"deadlines":[{"dateText":"10 July"}]}', chunk), /malformed deadline.*Retry/i);
  assert.throws(() => parseDeadlineJson('{"deadlines":[{"dateText":"10 July","requirement":"Apply","evidence":"by 9 July","kind":"explicit"}]}', chunk), /does not match.*Retry/i);
  assert.throws(() => parseDeadlineJson('{"deadlines":[{"dateText":"11 July","requirement":"Apply","evidence":"The application is due 10 July.","kind":"explicit"}]}', chunk), /marked a date explicit.*Retry/i);
});
