import { DocumentExtractionError, type PickedDocument } from '../types/document';

/** Fallback adapter for platforms without a dedicated browser implementation. */
export async function extractPdfInBrowser(_document: PickedDocument): Promise<string> {
  throw new DocumentExtractionError('unsupported', 'Browser PDF extraction is only available in the web build.');
}
