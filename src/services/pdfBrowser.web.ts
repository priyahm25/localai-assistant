import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DocumentExtractionError, type PickedDocument } from '../types/document';
import { logExtractionFailure } from './extractionDiagnostics';

const MAX_PDF_BYTES = 50 * 1024 * 1024;

/** Browser-only PDF.js adapter. It reads bytes from the picker File handle and never makes a request. */
export async function extractPdfInBrowser(documentFile: PickedDocument): Promise<string> {
  const file = documentFile.webFile;
  if (!file) {
    const error = new DocumentExtractionError('read', 'The browser could not access the selected PDF. Please select it again.');
    logExtractionFailure(documentFile, { stage: 'read-file', operation: 'read picker File handle', error, bytesObtained: false, byteLength: null });
    throw error;
  }
  if (file.size > MAX_PDF_BYTES) {
    const error = new DocumentExtractionError('unsupported', 'This PDF is larger than the 50 MB browser extraction limit.');
    logExtractionFailure(documentFile, { stage: 'validate-file', operation: 'check configured size limit', error, bytesObtained: false, byteLength: file.size });
    throw error;
  }
  if (!file.size) {
    const error = new DocumentExtractionError('empty', 'This PDF file is empty.');
    logExtractionFailure(documentFile, { stage: 'validate-file', operation: 'check file size', error, bytesObtained: false, byteLength: 0 });
    throw error;
  }

  let loadingTask: ReturnType<typeof getDocument> | undefined;
  let bytes: Uint8Array | undefined;
  let stage = 'read-file-bytes';
  let operation = 'browser File.arrayBuffer';
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    stage = 'configure-pdfjs-worker';
    operation = 'set PDF.js workerSrc to the app-local worker';
    if (typeof window !== 'undefined') GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).toString();
    stage = 'load-pdf';
    operation = 'PDF.js getDocument and worker initialization';
    loadingTask = getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false });
    const pdf = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      stage = 'extract-page-text';
      operation = `PDF.js page ${pageNumber} getTextContent`;
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '')
        .join('').replace(/[\t ]+\n/g, '\n').trim();
      if (pageText) pages.push(pageText);
    }
    await pdf.destroy();
    if (!pages.length) {
      stage = 'validate-extracted-text';
      operation = 'check extracted text across all PDF pages';
      const error = new DocumentExtractionError('scanned-pdf', 'This PDF has no extractable text. It may contain only scanned images; OCR is not included.');
      logExtractionFailure(documentFile, { stage, operation, error, bytesObtained: true, byteLength: bytes.byteLength });
      throw error;
    }
    return pages.join('\n\n');
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    logExtractionFailure(documentFile, { stage, operation, error, bytesObtained: Boolean(bytes), byteLength: bytes?.byteLength ?? null });
    const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
    if (name === 'PasswordException') throw new DocumentExtractionError('read', 'This PDF is encrypted or password protected. Password entry is not supported.');
    if (isWorkerFailure(error)) {
      throw new DocumentExtractionError('read', 'The browser PDF reader could not start its local PDF.js worker. Restart the web app and try again.');
    }
    if (['InvalidPDFException', 'MissingPDFException', 'FormatError', 'XRefParseException'].includes(name)) {
      throw new DocumentExtractionError('corrupt', 'This PDF is malformed or incomplete. Choose a valid, unencrypted PDF.');
    }
    throw new DocumentExtractionError('read', 'PDF.js could not extract text from this file. The PDF may use an unsupported feature or have damaged text data.');
  } finally {
    if (loadingTask) await loadingTask.destroy().catch(() => undefined);
  }
}

function isWorkerFailure(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /worker|workerSrc|fake worker|dynamically imported module/i.test(message);
}
