import type { PickedDocument } from '../types/document';

export interface ExtractionDiagnosticDetails {
  stage: string;
  operation: string;
  error: unknown;
  /** null means this parser does not expose the bytes to JavaScript. */
  bytesObtained?: boolean | null;
  byteLength?: number | null;
}

/** Logs technical failures only in development, without filenames, URIs, or document data. */
export function logExtractionFailure(
  picked: PickedDocument | undefined,
  details: ExtractionDiagnosticDetails,
  development = typeof __DEV__ !== 'undefined' && __DEV__,
): void {
  if (!development) return;
  const error = details.error;
  const name = error instanceof Error ? error.name : error && typeof error === 'object' && 'name' in error ? String(error.name) : typeof error;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const rawStack = error instanceof Error ? error.stack ?? '' : '';
  const privateValues = [picked?.uri, picked?.name].filter((value): value is string => Boolean(value));
  const sanitize = (value: string, max: number) => {
    let safe = value;
    for (const privateValue of privateValues) safe = safe.split(privateValue).join('[private file reference]');
    safe = safe
      .replace(/data:[^\s,]+,[^\s]+/gi, '[data omitted]')
      .replace(/(?:[a-z]:[\\/]|file:\/\/\/?)[^\s"'<>)}]+/gi, '[path omitted]')
      .replace(/(?:\/(?:Users|home|private|tmp)\/)[^\s"'<>)}]+/g, '[path omitted]');
    return safe.slice(0, max);
  };
  const extension = picked?.name.split('.').pop()?.toLowerCase() ?? 'unknown';
  const diagnostic = {
    stage: details.stage,
    operation: details.operation,
    extension,
    mimeType: picked?.mimeType ?? 'unknown',
    uriAvailable: Boolean(picked?.uri),
    fileHandleAvailable: Boolean(picked?.webFile),
    bytesObtained: details.bytesObtained ?? null,
    byteLength: details.byteLength ?? null,
    errorName: name,
    errorMessage: sanitize(rawMessage, 1200),
    stack: sanitize(rawStack, 4000) || undefined,
  };
  // Some browser/dev-console bridges collapse object arguments to the word
  // "Object". Serialize only the already-sanitized fields for readable logs.
  console.warn('[LocalAI extraction diagnostic]', JSON.stringify(diagnostic));
}
