import assert from 'node:assert/strict';
import test from 'node:test';
import { createAsyncSingleFlight } from '../src/services/asyncSingleFlight';
import { assertAnalysisChunkBudget, chunkDocument, chunkDocumentForSummary, summaryInferenceCallCount } from '../src/services/documentAnalysis';
import { runSummaryPipeline } from '../src/services/summaryPipeline';

test('short summary pipeline makes exactly one inference and skips combining', async () => {
  const chunks = chunkDocumentForSummary('[Page 1]\nA short document with its complete source text.');
  const prompts: string[] = [];
  const result = await runSummaryPipeline(chunks, () => {}, async (prompt) => {
    prompts.push(prompt);
    return 'Concise summary.';
  });
  assert.equal(summaryInferenceCallCount(chunks.length), 1);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /SOURCE section 1/);
  assert.match(prompts[0], /complete source text/);
  assert.equal(result, 'Concise summary.');
});

test('reports completion only after generation resolves and final aggregation finishes', async () => {
  const chunks = chunkDocumentForSummary('[Page 1]\nA complete source paragraph for the summary.');
  const progress: string[] = [];
  let settled = false;
  const resultPromise = runSummaryPipeline(chunks, (message) => progress.push(message), async (_prompt, _limit, _task, onFirstOutput) => {
    onFirstOutput?.();
    await Promise.resolve();
    settled = true;
    return 'Finished summary.';
  });
  assert.deepEqual(progress, [
    'Summarizing section 1 of 1 · waiting for model output…',
    'Summarizing section 1 of 1 · receiving model output…',
  ]);
  const result = await resultPromise;
  assert.equal(settled, true);
  assert.equal(result, 'Finished summary.');
  assert.equal(progress.at(-1), 'Final summary complete.');
});

test('surfaces generation failure and never reports a finished summary', async () => {
  const chunks = chunkDocument(['A'.repeat(650), 'B'.repeat(650)].join('\n\n'), undefined, true);
  const progress: string[] = [];
  let calls = 0;
  await assert.rejects(
    runSummaryPipeline(chunks, (message) => progress.push(message), async () => {
      calls += 1;
      if (calls === 1) throw new Error('native stream failed');
      return 'unexpected';
    }),
    /native stream failed/,
  );
  assert.equal(calls, 1);
  assert.ok(!progress.includes('Final summary complete.'));
});

test('long summary pipeline retains every section and combines serially', async () => {
  const chunks = chunkDocument(['A'.repeat(650), 'B'.repeat(650), 'C'.repeat(650)].join('\n\n'), undefined, true);
  const sourcePrompts: string[] = [];
  let calls = 0;
  const result = await runSummaryPipeline(chunks, () => {}, async (prompt) => {
    calls += 1;
    if (prompt.includes('Summarize this passage')) sourcePrompts.push(prompt);
    return `partial-${calls}`;
  });
  assert.equal(sourcePrompts.length, 3);
  assert.ok(sourcePrompts.some((prompt) => prompt.includes('A'.repeat(100))));
  assert.ok(sourcePrompts.some((prompt) => prompt.includes('B'.repeat(100))));
  assert.ok(sourcePrompts.some((prompt) => prompt.includes('C'.repeat(100))));
  assert.equal(calls, summaryInferenceCallCount(chunks.length));
  assert.equal(calls, 4);
  assert.match(result, /partial-4/);
});

test('five-section aggregation passes every summary through both combine levels', async () => {
  const source = Array.from({ length: 5 }, (_, index) => `[Page ${index + 1}]\n${String.fromCharCode(65 + index).repeat(600)}`).join('\n');
  const chunks = chunkDocumentForSummary(source);
  assert.equal(chunks.length, 5);

  const prompts: string[] = [];
  const result = await runSummaryPipeline(chunks, () => {}, async (prompt) => {
    prompts.push(prompt);
    if (prompt.includes('Summarize this passage')) {
      const page = prompt.match(/SOURCE page (\d+)/)?.[1];
      assert.ok(page, `missing source location in prompt: ${prompt}`);
      return `S${page}`;
    }
    const summaries = [...new Set(prompt.match(/S\d+/g) ?? [])];
    return `M(${summaries.join(',')})`;
  });

  assert.equal(prompts.length, 8);
  assert.equal(summaryInferenceCallCount(5), 8);
  assert.deepEqual(prompts.slice(0, 5).map((prompt) => prompt.match(/SOURCE page (\d+)/)?.[1]), ['1', '2', '3', '4', '5']);
  assert.match(prompts[5], /S1[\s\S]*S2[\s\S]*S3/);
  assert.match(prompts[6], /S4[\s\S]*S5/);
  assert.match(prompts[7], /M\(S1,S2,S3\)/);
  assert.match(prompts[7], /M\(S4,S5\)/);
  for (let page = 1; page <= 5; page += 1) {
    assert.match(prompts[7], new RegExp(`S${page}`));
    assert.match(result, new RegExp(`S${page}`));
  }
});

test('one-item remainder is carried forward without a one-input combine call', async () => {
  const chunks = chunkDocument(['A'.repeat(650), 'B'.repeat(650), 'C'.repeat(650), 'D'.repeat(650)].join('\n\n'), undefined, true);
  assert.equal(chunks.length, 4);
  const combinePrompts: string[] = [];
  let calls = 0;
  const result = await runSummaryPipeline(chunks, () => {}, async (prompt) => {
    calls += 1;
    if (prompt.includes('Combine these section summaries')) combinePrompts.push(prompt);
    if (prompt.includes('Summarize this passage')) return `S${calls}`;
    const summaries = [...new Set(prompt.match(/S\d+/g) ?? [])];
    return `M(${summaries.join(',')})`;
  });

  assert.equal(calls, 6);
  assert.equal(summaryInferenceCallCount(chunks.length), 6);
  assert.equal(combinePrompts.length, 2);
  assert.match(combinePrompts[0], /S1[\s\S]*S2[\s\S]*S3/);
  assert.doesNotMatch(combinePrompts[0], /S4/);
  assert.match(combinePrompts[1], /M\(S1,S2,S3\)/);
  assert.match(combinePrompts[1], /S4/);
  assert.match(result, /S4/);
});

test('rejects more than 32 sections before invoking inference', async () => {
  const chunks = Array.from({ length: 33 }, (_, index) => ({
    id: index + 1,
    text: `section-${index + 1}`,
    location: `section ${index + 1}`,
    start: index,
    end: index + 1,
  }));
  let calls = 0;

  await assert.rejects(async () => {
    // Production orchestration applies this guard before entering the pipeline.
    assertAnalysisChunkBudget(chunks);
    await runSummaryPipeline(chunks, () => {}, async () => {
      calls += 1;
      return 'unexpected';
    });
  }, /maximum 32 sections/);
  assert.equal(calls, 0);
});

test('duplicate UI requests share one in-flight operation', async () => {
  const flight = createAsyncSingleFlight<number>();
  let operations = 0;
  let release!: (value: number) => void;
  const operation = () => {
    operations += 1;
    return new Promise<number>((resolve) => { release = resolve; });
  };
  const first = flight.run(operation);
  const duplicate = flight.run(operation);
  await Promise.resolve();
  assert.equal(operations, 1);
  release(42);
  assert.deepEqual(await Promise.all([first, duplicate]), [42, 42]);
});
