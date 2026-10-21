import { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { type PickedDocument } from '../types/document';
import { extractTextFromDocument, readWithFallback } from './textContent';

export type TextReader = (uri: string) => Promise<string>;

/**
 * Read a picker-provided local URI using SDK 54's File API first. Some Android
 * providers/Expo Go builds reject the current File wrapper's permission check
 * for a picker cache URI; the SDK's legacy reader accepts the same file:// URI.
 * If both fail, retain both causes for a useful development error.
 */
export const readPickedText: TextReader = (uri) => readWithFallback(
  uri,
  (path) => new File(path).text(),
  (path) => LegacyFileSystem.readAsStringAsync(path, { encoding: LegacyFileSystem.EncodingType.UTF8 }),
);

export async function extractTextFile(
  document: PickedDocument,
  readText: TextReader = readPickedText,
): Promise<string> {
  return extractTextFromDocument(
    document,
    readText,
    typeof __DEV__ !== 'undefined' && __DEV__,
  );
}
