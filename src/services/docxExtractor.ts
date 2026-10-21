import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { DocumentExtractionError, type PickedDocument } from '../types/document';
import { logExtractionFailure } from './extractionDiagnostics';

const MAX_DOCX_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENT_XML_BYTES = 50 * 1024 * 1024;

function extractXmlText(value: unknown): string {
  if (Array.isArray(value)) return value.map(extractXmlText).join('');
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value as Record<string, unknown>).map(([key, child]) => {
    if (key === '#text') return typeof child === 'string' ? child : '';
    if (key === 'w:tab') return '\t';
    if (key === 'w:br' || key === 'w:cr') return '\n';
    if (key === 'w:p') return `${extractXmlText(child)}\n`;
    if (key === 'w:tc') return `${extractXmlText(child).trimEnd()}\t`;
    if (key === 'w:tr') return `${extractXmlText(child).trimEnd()}\n`;
    if (key === ':@') return '';
    return extractXmlText(child);
  }).join('');
}

export async function extractDocx(document: PickedDocument): Promise<string> {
  let bytes: Uint8Array | undefined;
  let stage = 'read-file-bytes';
  let operation = 'read browser File or Expo File.arrayBuffer';
  try {
    const source = document.webFile ?? new (await import('expo-file-system')).File(document.uri);
    if (document.size !== undefined && document.size > MAX_DOCX_BYTES) {
      throw new DocumentExtractionError('unsupported', 'This DOCX is larger than the 25 MB extraction limit.');
    }
    bytes = new Uint8Array(await source.arrayBuffer());
    if (bytes.length === 0) throw new DocumentExtractionError('empty', 'This DOCX file is empty.');
    if (bytes.length > MAX_DOCX_BYTES) throw new DocumentExtractionError('unsupported', 'This DOCX is larger than the 25 MB extraction limit.');
    stage = 'validate-zip-container';
    operation = 'check ZIP signature and detect legacy encrypted Office container';
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
      throw new DocumentExtractionError('unsupported', 'This file is encrypted or uses the older DOC format. Save it as an unencrypted DOCX and try again.');
    }
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Not a DOCX ZIP container');
    stage = 'open-zip-container';
    operation = 'fflate unzipSync';
    const entries = unzipSync(bytes);
    if (!entries['[Content_Types].xml']) throw new Error('Missing DOCX content types');
    stage = 'locate-document-xml';
    operation = 'find word/document.xml in ZIP entries';
    const documentXml = entries['word/document.xml'];
    if (!documentXml) throw new Error('Missing document.xml');
    if (documentXml.length > MAX_DOCUMENT_XML_BYTES) {
      throw new DocumentExtractionError('unsupported', 'This DOCX contains too much uncompressed document text to extract safely.');
    }
    stage = 'validate-document-xml';
    operation = 'fast-xml-parser XMLValidator.validate(word/document.xml)';
    const xml = strFromU8(documentXml);
    if (XMLValidator.validate(xml) !== true) throw new Error('Invalid Word XML');
    stage = 'parse-document-xml';
    operation = 'fast-xml-parser XMLParser.parse(word/document.xml)';
    const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true, processEntities: true });
    const mainText = extractXmlText(parser.parse(xml) as unknown)
      .replace(/\u00a0/g, ' ').replace(/[\t ]+\n/g, '\n').trim();

    // Headers, footers, footnotes, and endnotes are separate OOXML parts. Include
    // their text after the main body; pagination and section placement are not reconstructed.
    const relatedParts = Object.keys(entries)
      .filter((path) => /^word\/(?:header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(path))
      .sort();
    const additionalText: string[] = [];
    for (const path of relatedParts) {
      stage = 'parse-related-word-part';
      operation = `validate and parse ${path} XML`;
      const part = entries[path];
      if (part.length > MAX_DOCUMENT_XML_BYTES) throw new DocumentExtractionError('unsupported', 'This DOCX contains a Word XML part that exceeds the 50 MB extraction limit.');
      const partXml = strFromU8(part);
      if (XMLValidator.validate(partXml) !== true) throw new Error(`Invalid Word XML in ${path}`);
      const partText = extractXmlText(parser.parse(partXml) as unknown)
        .replace(/\u00a0/g, ' ').replace(/[\t ]+\n/g, '\n').trim();
      if (partText) additionalText.push(partText);
    }
    stage = 'validate-extracted-text';
    operation = 'check extracted text in document body and related Word parts';
    const text = [mainText, ...additionalText].filter(Boolean).join('\n\n');
    if (!text) throw new DocumentExtractionError('empty', 'No readable text was found in this DOCX file.');
    return text;
  } catch (error) {
    logExtractionFailure(document, { stage, operation, error, bytesObtained: Boolean(bytes), byteLength: bytes?.byteLength ?? null });
    if (error instanceof DocumentExtractionError) throw error;
    throw new DocumentExtractionError('corrupt', `This DOCX could not be ${stage === 'read-file-bytes' ? 'read' : 'parsed'} at the ${stage.replaceAll('-', ' ')} stage. Check that it is a valid, unencrypted DOCX file.`);
  }
}
