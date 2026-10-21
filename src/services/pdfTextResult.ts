import { DocumentExtractionError } from '../types/document';

export type PdfTextReader = (uri: string) => Promise<string>;

/** Validate output from a PDF parser; an empty result is typical of image-only scans. */
export async function extractPdfTextFromUri(
  uri: string,
  readPdf: PdfTextReader,
  nativePdfAvailable: boolean,
  isWeb = false,
): Promise<string> {
  if (!nativePdfAvailable) {
    const platformMessage = isWeb
      ? 'Browser PDF text extraction is unavailable.'
      : 'PDF extraction needs an installed Android development build. Expo Go does not include the native PDF reader.';
    throw new DocumentExtractionError('read', platformMessage);
  }
  try {
    const text = (await readPdf(uri)).trim();
    if (!text) throw new DocumentExtractionError('scanned-pdf', 'No selectable text was found. This may be a scanned PDF; OCR is not implemented in this phase.');
    return text;
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    if (error && typeof error === 'object' && 'code' in error && error.code === 'PASSWORD_REQUIRED') {
      throw new DocumentExtractionError('read', 'This PDF is password protected. Password entry is not implemented in this phase.');
    }
    throw new DocumentExtractionError('corrupt', 'This PDF is invalid, encrypted, or could not be read.');
  }
}
