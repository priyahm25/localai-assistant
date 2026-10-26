import { DocumentExtractionError, type ExtractionErrorCode, type PickedDocument } from '../types/document';

const SAFE_STAGES = new Set([
  'select-document', 'read-file-bytes', 'validate-zip-container', 'open-zip-container',
  'locate-document-xml', 'validate-document-xml', 'parse-document-xml', 'parse-related-word-part',
  'validate-extracted-text', 'check-native-module', 'extract-native-pdf-text',
  'load-browser-pdf-extractor', 'read-file', 'validate-file', 'configure-pdfjs-worker',
  'load-pdf', 'extract-page-text',
]);
const SAFE_ERROR_CODES = new Set<ExtractionErrorCode>(['unsupported', 'empty', 'scanned-pdf', 'corrupt', 'read']);

export interface ExtractionDiagnosticDetails {
  stage: string;
  operation: string;
  error: unknown;
  /** null means this parser does not expose the bytes to JavaScript. */
  bytesObtained?: boolean | null;
  byteLength?: number | null;
  durationMs?: number;
}

/** Logs technical failures only in development, without filenames, URIs, or document data. */
export function logExtractionFailure(
  picked: PickedDocument | undefined,
  details: ExtractionDiagnosticDetails,
  development = typeof __DEV__ !== 'undefined' && __DEV__,
): void {
  if (!development) return;
  const error = details.error;
  const errorCode = error instanceof DocumentExtractionError && SAFE_ERROR_CODES.has(error.code)
    ? error.code
    : error instanceof Error ? 'unexpected-error' : 'unknown-error';
  const format = picked?.format === 'txt' || picked?.format === 'pdf' || picked?.format === 'docx'
    ? picked.format
    : 'unknown';
  const diagnostic = {
    stage: SAFE_STAGES.has(details.stage) ? details.stage : 'unknown-stage',
    format,
    errorCode,
    bytesObtained: details.bytesObtained ?? null,
    byteLength: details.byteLength ?? null,
    durationMs: typeof details.durationMs === 'number' && Number.isFinite(details.durationMs) && details.durationMs >= 0
      ? details.durationMs
      : null,
  };
  console.warn('[LocalAI extraction diagnostic]', JSON.stringify(diagnostic));
}
