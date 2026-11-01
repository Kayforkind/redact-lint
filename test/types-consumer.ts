import { analyzePdf, EncryptedPdfError } from '../src/analyze.mjs';
import type { AnalyzeResult, Finding } from '../src/analyze.mjs';

const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const run = async (): Promise<AnalyzeResult> => analyzePdf(bytes, { showText: true, annotations: true });
const report = await run();

const first: Finding | undefined = report.findings[0];
if (first) {
  const page: number = first.page;
  const kind: string = first.kind;
  const color: string | null = first.fill.color;
  console.log(page, kind, color, first.covered.length, report.summary.leaks);
}

try {
  await analyzePdf(bytes);
} catch (err) {
  if (err instanceof EncryptedPdfError) console.log('needs a password');
}
