#!/usr/bin/env node
/**
 * Performance budget. Fails when a 200-page scan gets slower than the number
 * published in docs/BENCHMARK.md, so a regression shows up in CI rather than
 * in somebody's 600-page filing.
 *
 * Budget is deliberately generous: shared CI runners are slow and noisy, and a
 * flaky gate gets disabled, which is worse than a loose one.
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { analyzePdf } from '../src/analyze.mjs';

const PAGES = Number(process.env.PERF_PAGES || 200);
const BUDGET_MS = Number(process.env.PERF_BUDGET_MS || 20000);

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < PAGES; i++) {
  const page = doc.addPage([595, 842]);
  for (let line = 0; line < 20; line++) {
    page.drawText(`Page ${i + 1} line ${line + 1}: confidential record contents`, {
      x: 50,
      y: 800 - line * 12,
      size: 9,
      font,
    });
  }
  if (i % 25 === 0) page.drawRectangle({ x: 48, y: 788, width: 220, height: 10, color: rgb(0, 0, 0) });
}
const bytes = await doc.save();

const start = performance.now();
const result = await analyzePdf(bytes);
const elapsed = performance.now() - start;

console.log(
  `perf: ${PAGES} pages, ${result.textRuns} text runs, ${result.findings.length} finding(s) in ${Math.round(elapsed)} ms (budget ${BUDGET_MS} ms)`,
);

if (elapsed > BUDGET_MS) {
  console.error(`perf: over budget by ${Math.round(elapsed - BUDGET_MS)} ms`);
  process.exit(1);
}
