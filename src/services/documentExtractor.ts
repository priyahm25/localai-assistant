import type { PickedDocument } from '../types/document';
import { extractDocx } from './docxExtractor';
import { extractPdf } from './pdfExtractor';
import { extractTextFile } from './textExtractor';
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
  switch (document.format) {
    case 'txt': return extractTextFile(document);
    case 'pdf': return extractPdf(document);
    case 'docx': return extractDocx(document);
  }
}
