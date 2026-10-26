import assert from 'node:assert/strict';
import test from 'node:test';
import { extractTextFromDocument, extractTextFromUri, readWithFallback } from '../src/services/textContent';
import { extractPdfTextFromUri } from '../src/services/pdfTextResult';
import { extractPdfInBrowser } from '../src/services/pdfBrowser.web';
import { extractPdf as extractPdfForWeb } from '../src/services/pdfExtractor.web';
import { extractDocx } from '../src/services/docxExtractor';
import { zipSync, strToU8 } from 'fflate';
import { logExtractionFailure } from '../src/services/extractionDiagnostics';
import { DocumentExtractionError } from '../src/types/document';
import { logPerformance } from '../src/services/performanceDiagnostics';

test('TXT: returns UTF-8 text from the local reader', async () => {
  const result = await extractTextFromUri('file:///cache/note.txt', 'text/plain', async () => 'Café — hello\nSecond line');
  assert.equal(result, 'Café — hello\nSecond line');
});

test('TXT: reads the browser File handle rather than passing its blob URI to Expo FileSystem', async () => {
  const result = await extractTextFromDocument(
    { uri: 'blob:local-document', mimeType: 'text/plain', webFile: new Blob(['Browser-local text ✓']) },
    async () => { throw new Error('Expo FileSystem is not supported on web'); },
  );
  assert.equal(result, 'Browser-local text ✓');
});

test('TXT: rejects an empty file', async () => {
  await assert.rejects(
    extractTextFromUri('file:///cache/empty.txt', 'text/plain', async () => ''),
    (error: unknown) => error instanceof DocumentExtractionError && error.code === 'empty',
  );
});

test('TXT: preserves actionable local read errors in development', async () => {
  await assert.rejects(
    extractTextFromUri('file:///cache/blocked.txt', 'text/plain', async () => { throw new Error('EACCES: permission denied'); }, true),
    (error: unknown) => error instanceof DocumentExtractionError && error.message.includes('EACCES: permission denied'),
  );
});

test('TXT reader: retries with the SDK legacy reader if File.text() fails', async () => {
  const result = await readWithFallback(
    'file:///cache/note.txt',
    async () => { throw new Error('File.text permission check failed'); },
    async () => 'Recovered locally with legacy reader',
  );
  assert.equal(result, 'Recovered locally with legacy reader');
});

test('TXT reader: preserves both API errors if both local reads fail', async () => {
  await assert.rejects(
    readWithFallback(
      'file:///cache/blocked.txt',
      async () => { throw new Error('current read denied'); },
      async () => { throw new Error('legacy read denied'); },
    ),
    /current read denied.*legacy read denied/,
  );
});

test('PDF bridge: accepts text returned for a text-based PDF', async () => {
  const result = await extractPdfTextFromUri('file:///cache/digital.pdf', async () => 'Lease starts on 2026-11-01', true);
  assert.equal(result, 'Lease starts on 2026-11-01');
});

test('PDF bridge: identifies an empty scanned-PDF extraction and explains OCR is unavailable', async () => {
  await assert.rejects(
    extractPdfTextFromUri('file:///cache/scan.pdf', async () => '', true),
    (error: unknown) => error instanceof DocumentExtractionError && error.code === 'scanned-pdf' && error.message.includes('OCR is not implemented'),
  );
});

test('PDF bridge: explains that Expo Go has no native PDF module', async () => {
  await assert.rejects(
    extractPdfTextFromUri('file:///cache/digital.pdf', async () => 'unused', false),
    (error: unknown) => error instanceof DocumentExtractionError && error.message.includes('Expo Go'),
  );
});

test('PDF bridge: gives an explicit message for unsupported browser PDF extraction', async () => {
  await assert.rejects(
    extractPdfTextFromUri('blob:scan.pdf', async () => 'unused', false, true),
    (error: unknown) => error instanceof DocumentExtractionError && error.message.includes('PDF text extraction'),
  );
});

function makePdf(pages: string[]): Uint8Array {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  ];
  pages.forEach((text, i) => {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    const stream = text ? `BT /F1 18 Tf 72 720 Td (${text}) Tj ET` : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${pages.length * 2 + 3} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  const fontId = pages.length * 2 + 3;
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function pickedPdf(bytes: Uint8Array): Parameters<typeof extractPdfInBrowser>[0] {
  const file = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  return { name: 'fixture.pdf', uri: 'blob:fixture', mimeType: 'application/pdf', format: 'pdf', webFile: file, size: file.size };
}

function pickedDocx(xml: string, additionalParts: Record<string, Uint8Array> = {}): Parameters<typeof extractDocx>[0] {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    'word/document.xml': strToU8(xml),
    ...additionalParts,
  });
  const file = new Blob([bytes as BlobPart]);
  return { name: 'fixture.docx', uri: 'blob:fixture', format: 'docx', webFile: file, size: file.size };
}

test('TXT fixture: reads a normal UTF-8 text file locally', async () => {
  assert.equal(await extractTextFromDocument(
    { uri: 'blob:fixture', mimeType: 'text/plain', webFile: new Blob(['Café — hello\nSecond line']) },
    async () => { throw new Error('Browser File should be used'); },
  ), 'Café — hello\nSecond line');
});

test('PDF.js: extracts a simple text PDF', async () => {
  assert.match(await extractPdfInBrowser(pickedPdf(makePdf(['Browser PDF fixture']))), /Browser PDF fixture/);
});

test('PDF web entry point: extracts locally without loading the native module', async () => {
  assert.match(await extractPdfForWeb(pickedPdf(makePdf(['Web entry point fixture']))), /Web entry point fixture/);
});

test('PDF.js: extracts text from each page in a multi-page PDF', async () => {
  const result = await extractPdfInBrowser(pickedPdf(makePdf(['First page', 'Second page'])));
  assert.match(result, /First page/);
  assert.match(result, /Second page/);
});

test('PDF.js: identifies a valid PDF with no extractable text', async () => {
  await assert.rejects(extractPdfInBrowser(pickedPdf(makePdf(['']))),
    (error: unknown) => error instanceof DocumentExtractionError && error.code === 'scanned-pdf');
});

test('DOCX: extracts paragraphs and preserves Unicode, table cells, and line breaks', async () => {
  const xml = '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Café 東京</w:t></w:r><w:r><w:br/><w:t>next</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  const result = await extractDocx(pickedDocx(xml));
  assert.match(result, /Café 東京/);
  assert.match(result, /next/);
  assert.match(result, /A\t.*B/);
});

test('DOCX: extracts text from an ordinary multi-paragraph document', async () => {
  const xml = '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>First paragraph</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>';
  assert.equal(await extractDocx(pickedDocx(xml)), 'First paragraph\nSecond paragraph');
});

test('DOCX: includes text stored in common header and footer parts', async () => {
  const body = '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Body text</w:t></w:r></w:p></w:body></w:document>';
  const header = strToU8('<w:hdr xmlns:w="urn:w"><w:p><w:r><w:t>Header text</w:t></w:r></w:p></w:hdr>');
  const footer = strToU8('<w:ftr xmlns:w="urn:w"><w:p><w:r><w:t>Footer text</w:t></w:r></w:p></w:ftr>');
  const result = await extractDocx(pickedDocx(body, { 'word/header1.xml': header, 'word/footer1.xml': footer }));
  assert.match(result, /Body text/);
  assert.match(result, /Header text/);
  assert.match(result, /Footer text/);
});

test('DOCX: rejects an empty document body', async () => {
  await assert.rejects(extractDocx(pickedDocx('<w:document xmlns:w="urn:w"><w:body/></w:document>')),
    (error: unknown) => error instanceof DocumentExtractionError && error.code === 'empty');
});

test('DOCX: reports malformed and unsupported containers', async () => {
  const malformed = new Blob(['not a zip']);
  await assert.rejects(extractDocx({ name: 'bad.docx', uri: 'blob:bad', format: 'docx', webFile: malformed }),
    (error: unknown) => error instanceof DocumentExtractionError && error.code === 'corrupt' && error.message.includes('zip container'));
  const unsupported = new Blob([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])]);
  await assert.rejects(extractDocx({ name: 'old.doc', uri: 'blob:old', format: 'docx', webFile: unsupported }),
    (error: unknown) => error instanceof DocumentExtractionError && error.code === 'unsupported' && error.message.includes('DOC format'));
});

test('PDF.js: rejects malformed and empty PDF files with useful errors', async () => {
  await assert.rejects(extractPdfInBrowser(pickedPdf(new Uint8Array())),
    (error: unknown) => error instanceof DocumentExtractionError && error.code === 'empty');
  await assert.rejects(extractPdfInBrowser(pickedPdf(new TextEncoder().encode('not a pdf'))),
    (error: unknown) => error instanceof DocumentExtractionError && error.code === 'corrupt');
});

test('diagnostics: report safe error categories and metadata without filenames or document text', () => {
  const originalWarn = console.warn;
  const captured: unknown[][] = [];
  console.warn = (...values: unknown[]) => { captured.push(values); };
  try {
    logExtractionFailure(
      { name: 'private-report.docx', uri: 'file:///private/report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', format: 'docx', webFile: new Blob(['private text']) },
      { stage: 'open-zip-container', operation: 'fflate unzipSync', error: new Error('bad ZIP'), bytesObtained: true, byteLength: 42 },
      true,
    );
    logExtractionFailure(undefined, { stage: 'test', operation: 'disabled diagnostic', error: new Error('hidden') }, false);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(captured.length, 1);
  const payload = JSON.parse(String(captured[0][1])) as Record<string, unknown>;
  assert.equal(payload.stage, 'open-zip-container');
  assert.equal(payload.errorCode, 'unexpected-error');
  assert.equal(payload.format, 'docx');
  assert.equal(payload.bytesObtained, true);
  assert.equal(payload.byteLength, 42);
  assert.equal(payload.operation, undefined);
  assert.equal(payload.errorMessage, undefined);
  assert.equal(payload.stack, undefined);
  assert.equal(JSON.stringify(payload).includes('private-report.docx'), false);
  assert.equal(JSON.stringify(payload).includes('file:///private/report.docx'), false);
  assert.equal(JSON.stringify(payload).includes('private text'), false);
});

test('diagnostics omit a unique secret from both extraction error messages and stack traces', () => {
  const originalWarn = console.warn;
  const captured: unknown[][] = [];
  console.warn = (...values: unknown[]) => { captured.push(values); };
  const secret = 'FAKE_DOCUMENT_SECRET_92ad1e7';
  const error = new Error(`parser failed near ${secret}`);
  error.stack = `Error: ${secret}\n    at parser (private-document.xml:1:9)`;
  try {
    logExtractionFailure(
      { name: 'private-report.docx', uri: 'file:///private/report.docx', format: 'docx', webFile: new Blob([secret]) },
      { stage: 'parse-document-xml', operation: `parsing ${secret}`, error, bytesObtained: true, byteLength: 128 },
      true,
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(captured.length, 1);
  const payload = String(captured[0].join(' '));
  assert.doesNotMatch(payload, new RegExp(secret));
  assert.doesNotMatch(payload, /private-report\.docx|file:\/\/\/private\/report\.docx|private-document\.xml/);
  assert.match(payload, /"errorCode":"unexpected-error"/);
  assert.match(payload, /"stage":"parse-document-xml"/);
});

test('performance diagnostics log only numeric and boolean metrics in development', () => {
  const originalInfo = console.info;
  const captured: unknown[][] = [];
  console.info = (...values: unknown[]) => { captured.push(values); };
  try {
    logPerformance('text-extraction.pdf', { durationMs: 24, outputCharacters: 812, success: true }, true);
    logPerformance('text-extraction.txt', { durationMs: 3 }, false);
  } finally {
    console.info = originalInfo;
  }
  assert.equal(captured.length, 1);
  const serialized = String(captured[0][1]);
  assert.match(serialized, /"stage":"text-extraction.pdf"/);
  assert.match(serialized, /"durationMs":24/);
  assert.doesNotMatch(serialized, /filename|prompt|evidence|document text/i);
});
