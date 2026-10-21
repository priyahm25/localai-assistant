export type DocumentFormat = 'txt' | 'pdf' | 'docx';

export interface PickedDocument {
  name: string;
  uri: string;
  size?: number;
  mimeType?: string;
  format: DocumentFormat;
  /** Browser File handle supplied by expo-document-picker on web. */
  webFile?: Blob;
}

export interface ImportedDocument extends PickedDocument {
  extractedText: string;
}

export type ExtractionErrorCode = 'unsupported' | 'empty' | 'scanned-pdf' | 'corrupt' | 'read';

export class DocumentExtractionError extends Error {
  constructor(public readonly code: ExtractionErrorCode, message: string) {
    super(message);
    this.name = 'DocumentExtractionError';
  }
}
