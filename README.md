# LocalAI Assistant

An Expo app for importing PDF, TXT, and DOCX documents, extracting their text locally, and summarizing them with one downloadable on-device model at a time on Android.

## Setup

Requirements: Node.js 20.19+ and pnpm 9.15.9. Install dependencies and start Expo:

```sh
pnpm install
pnpm start
```

Run the local adapter tests with `pnpm test:unit`.

Press `a` in the Expo terminal to open an Android emulator, or scan the QR code with a compatible Expo Go app for document import. TXT and DOCX have Expo Go code paths. Browser PDF extraction uses local PDF.js; Android PDF extraction and AI require an installed custom development/native APK (not Expo Go). Expo Web remains available for document import and extraction; native AI is unavailable in the browser.

To create an Android development APK without Android Studio, sign in to Expo and run `corepack pnpm exec eas build --platform android --profile development`. Install the resulting APK, then run `corepack pnpm start` and open the installed development client. For an installable preview APK without the development launcher, use `corepack pnpm exec eas build --platform android --profile preview`. EAS cloud builds require an Expo account and project setup. Do not run `expo prebuild --clean`; the existing Android directory is retained and included in `.easignore`.

Checks:

```sh
pnpm typecheck
pnpm check:expo
```

## Architecture

- `src/screens/HomeScreen.tsx`: UI, loading/error state, and in-memory document state.
- `src/components/ActionButton.tsx`: reusable action button.
- `src/services/documentPicker.ts`: system picker and format identification.
- `src/services/documentExtractor.ts`: dispatches to format extractors.
- `src/services/{text,pdf,docx}Extractor.ts`: local TXT, native PDF, and DOCX extraction.
- `src/services/extractionDiagnostics.ts`: development-only stage diagnostics with document names, paths, bytes, and contents omitted.
- `src/components/DocumentAssistant.tsx`: one-action summarization UI and selected-model lifecycle.
- `src/services/localAiService.ts`: on-device model lifecycle, reuse, and summary inference.
- `src/services/documentAnalysis.ts`: bounded source chunking and streamed output limits.
- `src/services/summaryPipeline.ts`: per-section summaries and hierarchical combination for longer documents.
- `src/types/document.ts`: document metadata and typed extraction errors.

## Supported formats and limits

- **TXT:** UTF-8 text read from the picker cache on Android/iOS, or the browser-provided `File` handle on web.
- **PDF in the browser:** PDF.js extracts selectable text from the browser-provided `File` in memory. The local `public/pdf.worker.min.mjs` is prepared from the pinned dependency for Expo web; PDF bytes and text are not uploaded. Scanned/image-only PDFs have no extractable text; OCR is not included. Empty, malformed, encrypted/password-protected, and over-50-MB PDFs return errors.
- **PDF on Android:** `expo-pdf-text-extract` remains the native implementation, separate from browser parsing. It requires an installed development/native APK and has not been verified by browser testing. Expo Go does not include the native reader.
- **DOCX:** Validates the ZIP package and Word XML and preserves paragraph boundaries, table cell/row separators, line breaks, tabs, and Unicode. Text from header, footer, footnote, and endnote parts is appended after the document body; original page/section placement and repeated headers are not reconstructed. Files over 25 MB or expanded Word XML parts over 50 MB are rejected. Formatting, comments, tracked changes, embedded files, and text embedded in images are not analyzed.
- Unsupported extensions, empty files, and unreadable/corrupt input are handled with UI errors. Large inputs are limited to reduce memory use; extraction is not streamed.

### TXT read failures

The former generic TXT error hid the underlying exception. On web, the specific bug was passing a temporary `blob:` URL to Expo FileSystem, whose web implementation does not support filesystem reads; the picker also provides a browser `File`, which the app now reads directly. On Android, the picker copies the provider file into app cache as a local URI. The original device error was swallowed, so its exact native cause cannot be recovered after the fact; the app now tries current `File.text()` then the SDK legacy local reader, and shows both failure details in development if neither can read it.

## Privacy design

The native document picker copies selected files into the app cache (`copyToCacheDirectory: true`). On web the picker returns a temporary `blob:` URL and browser `File` handle; the picker is told not to make a second base64 copy. The app keeps the selected handle/metadata and extracted text in React memory and does not persist the text or send it anywhere. It attempts to delete the native cache copy or revoke the browser object URL when the document is replaced, cleared, or extraction fails. **Clear document** removes the active document and text from app state, but does not securely erase memory, JavaScript engine copies, operating-system caches, backups, or storage blocks.

Scanned PDF OCR is not included. Android summarization uses `expo-ai-kit` 0.18.2 and the existing Qwen3 0.6B int4 or Gemma 3 1B int4 LiteRT model. Qwen remains the default; only the selected model is loaded. The model downloads only after the user taps **Summarize**, and inference stays on device. Qwen has a 2,048-token context and Gemma has a 4,096-token context. The runtime does not expose a tokenizer or a reliable per-call output-token cap for these downloadable Android models. To stay within the smaller Qwen context, long documents are split into complete 700-character source sections; up to 32 sections are summarized and combined in a small hierarchy. Short documents up to 1,500 characters use one request. Streamed section summaries stop above 250 visible characters and combine responses above 450 characters. These are conservative character bounds, not exact token counts. Documents beyond the complete-analysis limit produce an explicit error; the app does not silently summarize only the beginning. Inference uses the CPU backend to keep memory use lower, with a speed tradeoff.

Expo Go and web cannot run the native model. The model download is the only direct app-level network request introduced by summarization; document text and summaries are not sent to a cloud inference service. No AI telemetry SDK or cloud fallback is included.

## Dependencies

- `expo`, `react`, `react-native`: app runtime.
- `expo-document-picker`: system document picker.
- `expo-file-system`: current `File.text()` and DOCX byte reads from local picker cache files.
- `expo-file-system/legacy`: documented fallback for native picker cache reads if the current File API rejects a URI; both readers stay local.
- `expo-status-bar`: Expo status bar integration.
- `expo-system-ui`: applies the configured light interface style.
- `expo-pdf-text-extract`: local native PDF text extraction (requires a development/native build, not Expo Go).
- `expo-ai-kit` 0.18.2: native on-device inference and verified downloadable models.
- `expo-build-properties`: declares Android minSdk 26 for the native LLM runtime.
- `expo-dev-client`: custom development app for native modules absent from Expo Go.
- `pdfjs-dist` 4.10.38: browser-only PDF parsing; its worker is copied locally into `public/` before web startup/export.
- `fflate`: in-memory ZIP decompression for DOCX.
- `fast-xml-parser`: parse and validate DOCX XML.
- `typescript`, `@types/react`, `expo-doctor`: typing and project checks.
- `tsx`, `@types/node`: execute and type-check the Node-based unit test suite.

## Test plan

1. In Expo Go on Android, select a UTF-8 TXT file; also try an empty file and verify a failed read shows the development error detail.
2. On web, select a TXT file and verify its browser-local `File` handle is used instead of Expo FileSystem.
3. In the web app, select single-page and multi-page text PDFs; test scanned, encrypted, malformed, empty, and oversized PDFs. This verifies browser PDF.js only.
4. Separately, in an Android development APK, verify a text PDF and scanned PDF. Browser results do not verify Android PDF support.
5. Test DOCX paragraphs, tables, Unicode, line breaks, and empty, malformed, unsupported, and oversized documents.
6. Try an unsupported file, cancel the picker, and clear a successfully imported document.
7. On Android, request a summary for a five-page document and confirm every page contributes; verify airplane-mode inference works and document contents do not appear in network requests/logging.
8. Use `scripts/measure-android-memory.ps1` with an attached Android device to sample process PSS before model initialization, after initialization, after extraction, during inference, and after summarization.

Development console diagnostics identify the failing stage and parser operation, file extension/MIME, URI/handle availability, byte-read status/length, and error name/message/stack. They omit filenames, URIs, file bytes, and document text; production builds do not log these details.

The `pnpm test:unit` suite includes local PDF and DOCX fixtures and covers TXT reading, PDF.js single/multiple pages and no-text/corrupt cases, DOCX paragraphs/tables/Unicode/header/footer/empty/malformed/unsupported cases, and native bridge behavior. Native Android extraction remains a separate device/APK check.

Run the checks above with the commands in Setup. Physical-device testing is still required for picker providers, native PDF extraction, model performance, and memory use.

