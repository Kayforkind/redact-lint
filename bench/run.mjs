#!/usr/bin/env node
/**
 * Runs the detector over the corpus and scores it.
 *
 *   node bench/run.mjs            print the report
 *   node bench/run.mjs --write    rewrite BENCHMARK.md
 *   node bench/run.mjs --check    exit 1 if accuracy drops below the floors
 *
 * Scoring is per document: a positive document counts as found when at least
 * one finding covers the planted secret. Per-finding scores would let a
 * detector that reports the same leak five times look precise.
 *
 * Documents with `match: "count"` are scored on the number of findings
 * instead, because their producer legitimately splits the secret across
 * several runs (Word breaks "123-45-6789" at each hyphen).
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzePdf, EncryptedPdfError } from '../src/analyze.mjs';
import { buildCorpus, SECRET } from './corpus.mjs';
import { buildRealCorpus } from './real.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FLOORS = { paintedRecall: 0.99, imageRecall: 0.99, falsePositiveDocs: 0 };

const args = new Set(process.argv.slice(2));
const check = args.has('--check');
const write = args.has('--write');

const corpus = [...(await buildCorpus()), ...(await buildRealCorpus())];
const classes = new Map();
const producers = new Map();
const failures = [];
const results = new Map();
const started = process.hrtime.bigint();

for (const doc of corpus) {
  const bucket = classes.get(doc.class) || { docs: [], expectedPos: 0, found: 0, fp: 0 };
  bucket.docs.push(doc.name);
  if (doc.expectedLeaks > 0) bucket.expectedPos++;

  const prod = producers.get(doc.producer) || { docs: 0, positives: 0, found: 0, fp: 0 };
  prod.docs++;
  if (doc.expectedLeaks > 0) prod.positives++;

  let result = null;
  let encryptedError = false;
  try {
    result = await analyzePdf(doc.bytes, { showText: true, annotations: true });
  } catch (err) {
    if (err instanceof EncryptedPdfError) encryptedError = true;
    else {
      failures.push(`${doc.name}: threw ${err?.message || err}`);
      classes.set(doc.class, bucket);
      producers.set(doc.producer, prod);
      continue;
    }
  }

  if (doc.expectedError) {
    if (!encryptedError) failures.push(`${doc.name}: expected an encrypted error, got a result`);
    classes.set(doc.class, bucket);
    producers.set(doc.producer, prod);
    continue;
  }

  const findings = result?.findings || [];
  const hits = findings.filter((f) => f.covered.some((c) => c.text.includes(SECRET)));
  const kindMatch = !doc.expectedKinds || doc.expectedKinds.every((kind) => findings.some((f) => f.kind === kind));
  const found =
    doc.expectedLeaks > 0
      ? kindMatch && (doc.match === 'count' ? findings.length === doc.expectedLeaks : hits.length > 0)
      : false;

  if (doc.expectedLeaks > 0) {
    if (found) {
      bucket.found++;
      prod.found++;
    } else {
      const got = findings.length ? findings.map((f) => `p${f.page}/${f.kind}`).join(', ') : 'no findings';
      failures.push(
        `${doc.name}: missed the planted leak (expected ${doc.expectedLeaks}${doc.expectedKinds ? ' ' + doc.expectedKinds.join('/') : ''}, got ${got})`,
      );
    }
  } else if (findings.length) {
    bucket.fp++;
    prod.fp++;
    const what = findings.map((f) => `p${f.page}/${f.kind}`).join(', ');
    failures.push(`${doc.name}: false positive (${what})`);
  }

  if (doc.notes && (result?.notes || []).length < doc.notes) {
    failures.push(`${doc.name}: expected ${doc.notes} annotation note(s), got ${(result?.notes || []).length}`);
  }

  results.set(doc.name, findings.length);
  classes.set(doc.class, bucket);
  producers.set(doc.producer, prod);
}

const ms = Number(process.hrtime.bigint() - started) / 1e6;

const rows = [];
let paintedRecall = 1;
let imageRecall = 1;
let falsePositiveDocs = 0;

for (const [name, b] of [...classes].sort(([a], [c]) => a.localeCompare(c))) {
  const recall = b.expectedPos ? b.found / b.expectedPos : null;
  // Document-level precision: documents correctly flagged over all flagged.
  const precision = b.found + b.fp > 0 ? b.found / (b.found + b.fp) : null;
  if (name === 'painted') paintedRecall = recall;
  if (name === 'image') imageRecall = recall;
  falsePositiveDocs += b.fp;
  rows.push({
    name,
    docs: b.docs.length,
    positives: b.expectedPos,
    found: b.found,
    missed: b.expectedPos - b.found,
    falsePositives: b.fp,
    recall,
    precision,
  });
}

const producerRows = [...producers]
  .sort(([a], [c]) => a.localeCompare(c))
  .map(([name, b]) => ({
    name,
    docs: b.docs,
    positives: b.positives,
    found: b.found,
    falsePositives: b.fp,
    recall: b.positives ? b.found / b.positives : null,
  }));

const fmt = (v) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const table = [
  '| Class | Docs | Positives | Found | Missed | False positives | Recall | Precision |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map(
    (r) => `| ${r.name} | ${r.docs} | ${r.positives} | ${r.found} | ${r.missed} | ${r.falsePositives} | ${fmt(r.recall)} | ${fmt(r.precision)} |`,
  ),
];

const producerTable = [
  '| Producer | Docs | Positives | Found | False positives | Recall |',
  '| --- | --- | --- | --- | --- | --- |',
  ...producerRows.map(
    (r) => `| ${r.name} | ${r.docs} | ${r.positives} | ${r.found} | ${r.falsePositives} | ${fmt(r.recall)} |`,
  ),
];

const realDocs = corpus.filter((doc) => doc.name.startsWith('real/'));
const realTable = [
  '| Document | Producer | Class | Expected | Reported |',
  '| --- | --- | --- | --- | --- |',
  ...realDocs.map((doc) => {
    const got = results.get(doc.name);
    const expected = doc.expectedLeaks > 0 ? `${doc.expectedLeaks} leak` : 'clean';
    const reported = got === undefined ? 'error' : doc.expectedLeaks > 0 ? `${got} finding${got === 1 ? '' : 's'}` : got === 0 ? 'clean' : `${got} finding(s)`;
    return `| \`${doc.name.replace('real/', '')}\` | ${doc.producer} | ${doc.class} | ${expected} | ${reported} |`;
  }),
];

const summary = [
  `Corpus: ${corpus.length} documents (${corpus.length - realDocs.length} generated, ${realDocs.length} exported by real software), ${rows.reduce((n, r) => n + r.positives, 0)} with a planted leak.`,
  `Painted-cover recall: ${fmt(paintedRecall)} · image-cover recall: ${fmt(imageRecall)} · false-positive documents: ${falsePositiveDocs}.`,
  `Runtime: ${Math.round(ms)} ms for the corpus on Node ${process.version}.`,
];

const md = [
  '# Benchmark',
  '',
  'Generated by `npm run bench`. Do not edit by hand.',
  '',
  '> **What this is.** Two bodies of evidence. A synthetic corpus built at run time across pdf-lib, PDFKit and a hand-written content stream, plus eight PDFs exported by Chrome 156, Microsoft Word 16 and ReportLab 5.0 and committed under `bench/real/pdfs`. The real documents are still fixtures — one planted leak each, or a deliberately clean layout — not a sample of published filings. Treat every number as a floor on the cases listed, not as a real-world error rate.',
  '',
  '## Scores',
  '',
  ...table,
  '',
  '## By producer',
  '',
  ...producerTable,
  '',
  '## Real-producer documents',
  '',
  ...realTable,
  '',
  ...summary.map((line) => `- ${line}`),
  '',
  '## Failures',
  '',
  failures.length ? failures.map((f) => `- ${f}`).join('\n') : 'None.',
  '',
  '## What the corpus covers',
  '',
  '- painted covers: tight and loose boxes, black/white/grey, rotated page, two columns, five producers',
  '- image covers pasted over text (pdf-lib and Chrome), and page-sized scans that must not be flagged',
  '- clean documents: zebra tables, dark header bars with white text, watermarks, a form, a blank page',
  '- Word table shading, where cell fills and cell text operators are interleaved — the case that exposed an operator-pairing bug',
  '- Chrome splitting one line across several text operators, and Word splitting a hyphenated number into six runs',
  '- edge cases decided by the documented thresholds: partial coverage (under 60%, not reported), bars over empty space',
  '- encrypted documents: excluded from the scores, asserted separately as an error path',
  '',
  '## What it does not cover',
  '',
  '- LibreOffice, LaTeX, Acrobat and Google Docs output — not reproducible on the machine this corpus was built on',
  '- real scanned documents with OCR layers, CJK and right-to-left text',
  '- partially transparent covers, clipping, blend modes',
  '- documents larger than a few hundred pages',
  '',
  'The first gap matters most. Add a document exported by the software your team actually uses to `bench/real/manifest.json`, and its PDF to `bench/real/pdfs`; `bench:check` will score it on the next run. Regeneration instructions are in `bench/real/README.md`.',
  '',
].join('\n');

console.log(table.join('\n'));
console.log('');
console.log(producerTable.join('\n'));
console.log('');
for (const line of summary) console.log(line);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}

if (write) {
  await writeFile(path.join(ROOT, 'BENCHMARK.md'), md);
  console.log('\nwrote BENCHMARK.md');
}

if (check) {
  const problems = [];
  if (paintedRecall < FLOORS.paintedRecall) problems.push(`painted recall ${fmt(paintedRecall)} < ${fmt(FLOORS.paintedRecall)}`);
  if (imageRecall < FLOORS.imageRecall) problems.push(`image recall ${fmt(imageRecall)} < ${fmt(FLOORS.imageRecall)}`);
  if (falsePositiveDocs > FLOORS.falsePositiveDocs) problems.push(`${falsePositiveDocs} false-positive document(s)`);
  if (problems.length) {
    console.error(`\nbenchmark floors not met: ${problems.join('; ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nbenchmark floors met');
  }
}
