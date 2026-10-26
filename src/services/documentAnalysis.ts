export const QWEN_CONTEXT_TOKENS = 2_048;
// The runtime exposes no tokenizer. Keep long source sections conservative for
// Qwen's 2,048-token context, including the prompt and generated response.
export const SOURCE_CHUNK_CHARACTERS = 700;
export const MAX_SINGLE_CALL_SUMMARY_CHARACTERS = 1_500;
export const MAX_ANALYSIS_CHUNKS = 32;
export const MAX_RAW_STREAM_CHARACTERS = 12_000;

export interface DocumentChunk {
  id: number;
  text: string;
  location: string;
  start: number;
  end: number;
}

export function assertAnalysisChunkBudget(chunks: DocumentChunk[]): void {
  if (chunks.length > MAX_ANALYSIS_CHUNKS) {
    throw new Error(`This document is too large for complete on-device summarization (maximum ${MAX_ANALYSIS_CHUNKS} sections of about ${SOURCE_CHUNK_CHARACTERS} characters each). Choose a shorter document; no sections were skipped.`);
  }
}

export function shouldActivateModel(activeModelId: string | undefined, targetModelId: string): boolean {
  return activeModelId !== targetModelId;
}

/** Number of serial source and combine calls used by the three-way summary tree. */
export function summaryInferenceCallCount(chunkCount: number): number {
  if (!Number.isInteger(chunkCount) || chunkCount < 1) return 0;
  let calls = chunkCount;
  let layerCount = chunkCount;
  while (layerCount > 1) {
    const fullGroups = Math.floor(layerCount / 3);
    const remainder = layerCount % 3;
    const combinedGroups = fullGroups + (remainder === 2 ? 1 : 0);
    layerCount = combinedGroups + (remainder === 1 ? 1 : 0);
    calls += combinedGroups;
  }
  return calls;
}

export function logChunkMetrics(sourceText: string, chunks: DocumentChunk[]): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.debug('[local-ai:chunk-metrics]', {
      task: 'summary',
      sourceCharacters: sourceText.length,
      chunkCount: chunks.length,
      chunkLengths: chunks.map((chunk) => chunk.text.length),
    });
  }
}

/** Split without dropping non-whitespace content; retain page labels when present. */
export function chunkDocument(text: string, maxCharacters = SOURCE_CHUNK_CHARACTERS, mergeParagraphs = false): DocumentChunk[] {
  if (!text.trim()) throw new Error('There is no extracted document text to analyze.');
  if (!Number.isInteger(maxCharacters) || maxCharacters < 100) throw new Error('The document chunk limit is invalid.');
  if (mergeParagraphs && text.trim().length <= maxCharacters) {
    return [{ id: 1, text: text.trim(), location: 'section 1', start: 0, end: text.length }];
  }

  const chunks: DocumentChunk[] = [];
  let cursor = 0;
  let sectionNumber = 1;
  let pageNumber: number | undefined;
  const lines = text.split(/(?<=\n)/);
  let current = '';
  let currentStart = 0;
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push({
      id: chunks.length + 1,
      text: trimmed,
      location: pageNumber ? `page ${pageNumber}, section ${sectionNumber}` : `section ${sectionNumber}`,
      start: currentStart,
      end: cursor,
    });
    current = '';
    currentStart = cursor;
  };

  for (const line of lines) {
    const page = line.match(/^\s*(?:\[\s*)?(?:page|p\.)\s*(\d+)(?:\s*\])?\s*$/i);
    const heading = line.trim().length <= 100 && /^(?:#{1,6}\s+|(?:section|chapter|article)\s+[\w.-]+\b|[A-Z][^.!?]{2,80}:$)/i.test(line.trim());
    if (page) {
      flush();
      pageNumber = Number(page[1]);
      sectionNumber = 1;
      cursor += line.length;
      currentStart = cursor;
      continue;
    }
    if (!line.trim()) {
      if (mergeParagraphs) current += line;
      else { flush(); sectionNumber += 1; }
      cursor += line.length;
      if (!mergeParagraphs) currentStart = cursor;
      continue;
    }
    if (heading && current.trim()) { flush(); sectionNumber += 1; }
    if (line.length > maxCharacters) {
      flush();
      for (let offset = 0; offset < line.length; offset += maxCharacters) {
        const part = line.slice(offset, offset + maxCharacters).trim();
        if (part) chunks.push({
          id: chunks.length + 1,
          text: part,
          location: pageNumber ? `page ${pageNumber}, section ${sectionNumber}` : `section ${sectionNumber}`,
          start: cursor + offset,
          end: cursor + Math.min(offset + maxCharacters, line.length),
        });
        sectionNumber += 1;
      }
      cursor += line.length;
      currentStart = cursor;
      continue;
    }
    if (current.length && current.length + line.length > maxCharacters) flush();
    current += line;
    cursor += line.length;
  }
  flush();
  if (!chunks.length) throw new Error('There is no readable document text to analyze.');
  return chunks;
}

/** Keep short documents to one inference; split longer documents into bounded sections. */
export function chunkDocumentForSummary(text: string): DocumentChunk[] {
  const maxCharacters = text.trim().length <= MAX_SINGLE_CALL_SUMMARY_CHARACTERS
    ? MAX_SINGLE_CALL_SUMMARY_CHARACTERS
    : SOURCE_CHUNK_CHARACTERS;
  return chunkDocument(text, maxCharacters, true);
}

export function ensureDocumentText(text: string): void {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The selected document has no extracted text to analyze.');
}

export function stripModelThinking(raw: string): { text: string; reasoning: string } {
  if (raw.indexOf('<think>') === -1) return { text: raw, reasoning: '' };
  const reasoningParts: string[] = [];
  let text = raw.replace(/<think>([\s\S]*?)<\/think>/g, (_match, inner: string) => {
    reasoningParts.push(inner.trim());
    return '';
  });
  text = text.replace(/<think>([\s\S]*)$/, (_match, inner: string) => {
    reasoningParts.push(inner.trim());
    return '';
  });
  return { text: text.trim(), reasoning: reasoningParts.filter(Boolean).join('\n\n') };
}

export function inspectAccumulatedOutput(raw: string, visibleLimit: number, rawLimit = MAX_RAW_STREAM_CHARACTERS) {
  const visibleText = stripModelThinking(raw).text;
  return {
    rawCharacters: raw.length,
    visibleCharacters: visibleText.length,
    excessive: visibleText.length > visibleLimit || raw.length > rawLimit,
  };
}

/** Count visible streamed characters incrementally, including tags split across events. */
export function createStreamingOutputInspector(visibleLimit: number, rawLimit = MAX_RAW_STREAM_CHARACTERS) {
  let rawCharacters = 0;
  let visibleCharacters = 0;
  let inThinking = false;
  let pending = '';

  return (token: string) => {
    rawCharacters += token.length;
    pending += token;
    while (pending) {
      const marker = inThinking ? '</think>' : '<think>';
      const markerIndex = pending.indexOf(marker);
      if (markerIndex === 0) {
        pending = pending.slice(marker.length);
        inThinking = !inThinking;
        continue;
      }
      if (markerIndex > 0) {
        if (!inThinking) visibleCharacters += markerIndex;
        pending = pending.slice(markerIndex + marker.length);
        inThinking = !inThinking;
        continue;
      }
      let keep = Math.min(marker.length - 1, pending.length);
      while (keep > 0 && !marker.startsWith(pending.slice(-keep))) keep -= 1;
      const consume = pending.length - keep;
      if (!inThinking) visibleCharacters += consume;
      pending = pending.slice(consume);
      break;
    }
    return {
      rawCharacters,
      visibleCharacters,
      excessive: visibleCharacters > visibleLimit || rawCharacters > rawLimit,
    };
  };
}
