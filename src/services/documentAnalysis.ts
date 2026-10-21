export const QWEN_CONTEXT_TOKENS = 2_048;
// expo-ai-kit does not expose a tokenizer for Qwen. Keep each source excerpt
// deliberately small (characters, not words) and use short fixed prompts.
export const SOURCE_CHUNK_CHARACTERS = 700;
export const MAX_STREAMED_RESPONSE_CHARACTERS = 600;
const SEARCH_STOP_WORDS = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'what', 'when', 'where', 'who', 'why', 'how', 'is', 'in', 'on', 'at', 'to', 'of', 'for', 'by', 'from', 'and', 'or', 'about', 'this', 'that', 'it', 'my', 'me', 'i']);

export interface DocumentChunk {
  id: number;
  text: string;
  location: string;
  start: number;
  end: number;
}

export interface DeadlineCandidate {
  dateText: string;
  requirement: string;
  evidence: string;
  kind: 'explicit' | 'inferred';
}

export interface ValidatedDeadline {
  dateText: string;
  requirement: string;
  evidence: string;
  kind: 'explicit' | 'inferred';
  location: string;
}

export function chunkDocument(text: string, maxCharacters = SOURCE_CHUNK_CHARACTERS): DocumentChunk[] {
  if (!text.trim()) throw new Error('There is no extracted document text to analyze.');
  if (!Number.isInteger(maxCharacters) || maxCharacters < 100) throw new Error('The document chunk limit is invalid.');

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
    if (page) { flush(); pageNumber = Number(page[1]); sectionNumber = 1; cursor += line.length; currentStart = cursor; continue; }
    if (!line.trim()) { flush(); sectionNumber += 1; cursor += line.length; currentStart = cursor; continue; }
    if (heading && current.trim()) { flush(); sectionNumber += 1; }

    if (line.length > maxCharacters) {
      flush();
      for (let offset = 0; offset < line.length; offset += maxCharacters) {
        const part = line.slice(offset, offset + maxCharacters).trim();
        if (part) chunks.push({ id: chunks.length + 1, text: part, location: pageNumber ? `page ${pageNumber}, section ${sectionNumber}` : `section ${sectionNumber}`, start: cursor + offset, end: cursor + Math.min(offset + maxCharacters, line.length) });
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

export function rankRelevantChunks(chunks: DocumentChunk[], question: string, limit = 4): DocumentChunk[] {
  const terms = normalize(question).split(/\s+/).filter((term) => term.length > 1 && !SEARCH_STOP_WORDS.has(term));
  const ranked = chunks.map((chunk) => {
    const body = normalize(chunk.text);
    const score = terms.reduce((sum, term) => sum + (body.includes(term) ? 1 + Math.min(3, (body.match(new RegExp(escapeRegExp(term), 'g'))?.length ?? 1) - 1) : 0), 0);
    return { chunk, score };
  }).sort((a, b) => b.score - a.score || a.chunk.id - b.chunk.id);
  const matches = ranked.filter(({ score }) => score > 0).slice(0, limit).map(({ chunk }) => chunk);
  // Return no fabricated match when lexical search finds nothing.
  return matches;
}

export function validateDeadlineCandidates(value: unknown, chunk: DocumentChunk): ValidatedDeadline[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { deadlines?: unknown }).deadlines)) {
    throw new Error('The model returned an invalid deadline response. Retry the analysis.');
  }
  const items = (value as { deadlines: unknown[] }).deadlines;
  return items.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('The model returned a malformed deadline. Retry the analysis.');
    const candidate = item as Partial<DeadlineCandidate>;
    if (typeof candidate.dateText !== 'string' || !candidate.dateText.trim() ||
        typeof candidate.requirement !== 'string' || !candidate.requirement.trim() ||
        typeof candidate.evidence !== 'string' || !candidate.evidence.trim() ||
        (candidate.kind !== 'explicit' && candidate.kind !== 'inferred')) {
      throw new Error('The model returned a malformed deadline. Retry the analysis.');
    }
    if (!chunk.text.includes(candidate.evidence)) {
      throw new Error('The model returned deadline evidence that does not match the source text. Retry the analysis.');
    }
    if (candidate.kind === 'explicit' && !candidate.evidence.includes(candidate.dateText)) {
      throw new Error('The model marked a date explicit, but its wording is not present in the quoted evidence. Retry the analysis.');
    }
    return { ...candidate, location: chunk.location } as ValidatedDeadline;
  });
}

export function parseDeadlineJson(text: string, chunk: DocumentChunk): ValidatedDeadline[] {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error('The model response was not valid JSON. Retry the analysis.'); }
  return validateDeadlineCandidates(value, chunk);
}

export function ensureDocumentText(text: string): void {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The selected document has no extracted text to analyze.');
}

function normalize(value: string): string { return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
