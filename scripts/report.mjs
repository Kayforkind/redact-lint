#!/usr/bin/env node
/**
 * Prints the scan result to the job log and appends a compact markdown table
 * to $GITHUB_STEP_SUMMARY so the reviewer sees the leak without opening logs.
 */
import { readFileSync, appendFileSync } from 'node:fs';

const [reportPath, filesPath] = process.argv.slice(2);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const files = filesPath
  ? readFileSync(filesPath, 'utf8').split('\n').map((f) => f.trim()).filter(Boolean)
  : [];
const MAX_LINES = 12;

const lines = [];
const rows = [];
let shown = 0;

for (const file of report.files || []) {
  const findings = file.findings || [];
  if (!findings.length) {
    lines.push(`OK    ${file.file}`);
    continue;
  }
  lines.push(`LEAK  ${file.file}`);
  for (const f of findings) {
    if (shown >= MAX_LINES) continue;
    shown++;
    const cover = f.fill.type === 'image' ? 'image' : f.fill.color;
    lines.push(`  page ${f.page}  ${f.kind}  ${cover} ${f.fill.w}×${f.fill.h}pt`);
    for (const run of f.covered) {
      lines.push(`    "${run.text}"  still extractable, ${Math.round(run.coverage * 100)}% covered`);
      rows.push(
        `| \`${file.file}\` | ${f.page} | ${f.kind} | ${cover} ${f.fill.w}×${f.fill.h}pt | \`${run.text}\` | ${Math.round(run.coverage * 100)}% |`,
      );
    }
  }
}

const total = report.leaks || 0;
const pageWord = (n) => `${n} ${n === 1 ? 'page' : 'pages'}`;
lines.push('');
lines.push(`${report.files.length} file(s) · ${total === 0 ? 'no leaks' : `${total} leak${total === 1 ? '' : 's'}`}`);
if (total > shown) lines.push(`(${total - shown} more finding(s) omitted from the log)`);
console.log(lines.join('\n'));

const summary = [];
summary.push(`### redact-lint: ${total === 0 ? 'clean' : `${total} leak${total === 1 ? '' : 's'}`}`);
summary.push('');
if (total === 0) {
  summary.push(`No painted-over text found in ${files.length || report.files.length} PDF(s).`);
} else {
  summary.push('A rectangle only redacts if the text underneath was removed. These runs are covered but still in the file:');
  summary.push('');
  summary.push('| File | Page | Kind | Fill | Covered text | Coverage |');
  summary.push('| --- | --- | --- | --- | --- | --- |');
  summary.push(...rows.slice(0, 50));
  summary.push('');
  summary.push('Re-export with real redaction (content deleted) instead of drawing a shape on top. Text is masked; run locally with `--show-text` to review it.');
}
summary.push('');
summary.push(
  `<sub>${pageWord(report.files.reduce((n, f) => n + (f.pages || 0), 0))} scanned by redact-lint ${report.version}</sub>`,
);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
} else {
  console.log('\n--- job summary ---');
  console.log(summary.join('\n'));
}
