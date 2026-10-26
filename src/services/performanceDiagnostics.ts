export type PerformanceStage =
  | 'document-import'
  | 'document-picker'
  | 'text-extraction.txt'
  | 'text-extraction.pdf'
  | 'text-extraction.docx'
  | 'model-download'
  | 'model-load'
  | 'model-preparation'
  | 'model-inference'
  | 'summary-total'
  | 'summary-tap-to-display';

/** Development-only timing log. Numeric/boolean metrics prevent accidental content logging. */
export function logPerformance(
  stage: PerformanceStage,
  metrics: Readonly<Record<string, number | boolean>>,
  development = typeof __DEV__ !== 'undefined' && __DEV__,
): void {
  if (!development) return;
  console.info('[LocalAI performance]', JSON.stringify({ stage, ...metrics }));
}
