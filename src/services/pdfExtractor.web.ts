import type { PickedDocument } from '../types/document';
import { extractPdfInBrowser } from './pdfBrowser.web';

/** Web entry point: deliberately excludes the native-only Expo PDF module. */
export async function extractPdf(document: PickedDocument): Promise<string> {
  return extractPdfInBrowser(document);
}
