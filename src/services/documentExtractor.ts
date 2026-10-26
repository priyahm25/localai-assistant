import type { PickedDocument } from '../types/document';
import { extractDocx } from './docxExtractor';
import { extractPdf } from './pdfExtractor';
import { extractTextFile } from './textExtractor';
import { logPerformance } from './performanceDiagnostics';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

/** The picker copies selected files into this app's cache; remove that copy when done. */
export function discardPickedFile(uri: string): void {
  if (Platform.OS === 'web') {
    if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
    return;
  }
  try { new File(uri).delete(); } catch { /* Cache entries may already have been removed by the OS. */ }
}

export async function extractDocument(document: PickedDocument): Promise<string> {
  const startedAt = Date.now();
  let resultLength = 0;
  let success = false;
  try {
    let text: string;
    switch (document.format) {
      case 'txt': text = await extractTextFile(document); break;
      case 'pdf': text = await extractPdf(document); break;
      case 'docx': text = await extractDocx(document); break;
    }
    resultLength = text.length;
    success = true;
    return text;
  } finally {
    logPerformance(`text-extraction.${document.format}`, {
      durationMs: Date.now() - startedAt,
      outputCharacters: resultLength,
      success,
    });
  }
}
