import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { DocumentExtractionError, type DocumentFormat, type PickedDocument } from '../types/document';

const FORMAT_BY_EXTENSION: Record<string, DocumentFormat> = { txt: 'txt', pdf: 'pdf', docx: 'docx' };

export async function selectDocument(): Promise<PickedDocument | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    copyToCacheDirectory: true,
    base64: false,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) throw new DocumentExtractionError('read', 'The document picker returned no file.');
  const extension = asset.name.split('.').pop()?.toLowerCase() ?? '';
  const format = FORMAT_BY_EXTENSION[extension];
  if (!format) {
    if (Platform.OS === 'web') URL.revokeObjectURL(asset.uri);
    else try { new File(asset.uri).delete(); } catch { /* Best effort for the picker cache copy. */ }
    throw new DocumentExtractionError('unsupported', 'Choose a TXT, PDF, or DOCX document.');
  }
  return { name: asset.name, uri: asset.uri, size: asset.size, mimeType: asset.mimeType, format, webFile: asset.file };
}
