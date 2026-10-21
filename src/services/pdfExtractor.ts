import { isAvailable, extractText } from 'expo-pdf-text-extract';
import { Platform } from 'react-native';
import { DocumentExtractionError, type PickedDocument } from '../types/document';
import { extractPdfTextFromUri, type PdfTextReader } from './pdfTextResult';
import { logExtractionFailure } from './extractionDiagnostics';

export type { PdfTextReader } from './pdfTextResult';

export async function extractPdf(
  document: PickedDocument,
  readPdf: PdfTextReader = extractText,
  nativePdfAvailable: () => boolean = isAvailable,
): Promise<string> {
  if (Platform.OS === 'web') {
    let extractPdfInBrowser: (input: PickedDocument) => Promise<string>;
    try {
      ({ extractPdfInBrowser } = await import('./pdfBrowser'));
    } catch (error) {
      if (error instanceof DocumentExtractionError) throw error;
      logExtractionFailure(document, {
        stage: 'load-browser-pdf-extractor',
        operation: 'dynamic import of the web PDF.js adapter chunk',
        error,
        bytesObtained: false,
        byteLength: null,
      });
      throw new Error('The browser PDF reader could not be loaded. Restart the web app and try again.');
    }
    return extractPdfInBrowser(document);
  }
  let stage = 'check-native-module';
  let operation = 'expo-pdf-text-extract isAvailable';
  let parserError: unknown;
  try {
    const available = nativePdfAvailable();
    if (available) {
      stage = 'extract-native-pdf-text';
      operation = 'expo-pdf-text-extract extractText (native PDFKit/PDFBox)';
    }
    const instrumentedReader: PdfTextReader = async (uri) => {
      try { return await readPdf(uri); }
      catch (error) { parserError = error; throw error; }
    };
    return await extractPdfTextFromUri(document.uri, instrumentedReader, available);
  } catch (error) {
    logExtractionFailure(document, {
      stage,
      operation,
      error: parserError ?? error,
      // The native module reads the file internally and does not expose its byte buffer.
      bytesObtained: null,
      byteLength: null,
    });
    throw error;
  }
}
