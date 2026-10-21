import { DocumentExtractionError } from '../types/document';

export type UriTextReader = (uri: string) => Promise<string>;

export interface TextDocumentSource {
  uri: string;
  mimeType?: string;
  webFile?: Blob;
}

export async function readWithFallback(uri: string, currentReader: UriTextReader, fallbackReader: UriTextReader): Promise<string> {
  try {
    return await currentReader(uri);
  } catch (currentError) {
    try {
      return await fallbackReader(uri);
    } catch (fallbackError) {
      const currentMessage = currentError instanceof Error ? currentError.message : String(currentError);
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`Current File.text() failed: ${currentMessage}. Legacy readAsStringAsync also failed: ${fallbackMessage}`);
    }
  }
}

/** Validate UTF-8 text returned by a local reader and preserve useful read failures in development. */
export async function extractTextFromUri(
  uri: string,
  mimeType: string | undefined,
  readText: UriTextReader,
  development = false,
): Promise<string> {
  let text: string;
  try {
    text = await readText(uri);
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new DocumentExtractionError(
      'read',
      development
        ? `Could not read the selected TXT file (${mimeType ?? 'unknown MIME type'}). ${detail}`
        : 'This text file could not be read. Check that the file is available and try again.',
    );
  }
  if (!text.trim()) throw new DocumentExtractionError('empty', 'This text file is empty.');
  return text;
}

export function extractTextFromDocument(
  document: TextDocumentSource,
  localReader: UriTextReader,
  development = false,
): Promise<string> {
  const reader = document.webFile ? async () => document.webFile!.text() : () => localReader(document.uri);
  return extractTextFromUri(document.uri, document.mimeType, reader, development);
}
