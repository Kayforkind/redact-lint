#!/usr/bin/env node
/**
 * Regenerates the real-producer corpus in bench/real/pdfs.
 *
 *   node bench/real/make.mjs              build with whatever this machine has
 *   node bench/real/make.mjs --only word  build one producer
 *
 * The PDFs are committed so CI can score them without installing Chrome,
 * Word or ReportLab. This script exists to make them reproducible, and it
 * verifies every file against bench/real/manifest.json after building.
 *
 * Word is only reachable through COM on Windows, Firefox's print pipeline
 * cannot be driven headless without a display, and LaTeX is not installed on
 * the machine this corpus was built on. Those are recorded as gaps in
 * BENCHMARK.md rather than approximated here.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyzePdf } from '../../src/analyze.mjs';
import { SECRET } from '../corpus.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'pdfs');
const SOURCES = path.join(HERE, 'sources');
const manifest = JSON.parse(await readFile(path.join(HERE, 'manifest.json'), 'utf8'));

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i === -1 ? null : process.argv[i + 1];
})();

function chromiumBinary() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function pythonBinary() {
  for (const candidate of [process.env.PYTHON, 'python3', 'python']) {
    if (!candidate) continue;
    const probe = spawnSync(candidate, ['-c', 'import reportlab'], { stdio: 'ignore' });
    if (probe.status === 0) return candidate;
  }
  return null;
}

const chrome = chromiumBinary();
const python = pythonBinary();
const word = process.platform === 'win32' && existsSync('C:/Program Files/Microsoft Office/root/Office16/WINWORD.EXE');

function say(what) {
  console.log(`\n== ${what}`);
}

async function buildChromium() {
  if (!chrome) return console.log('chromium: no Chrome/Chromium binary, skipped');
  const pages = ['paint-over', 'whiteout', 'image-cover', 'clean-report'];
  for (const page of pages) {
    const source = path.join(SOURCES, `${page}.html`);
    const target = path.join(OUT, `chromium-${page}.pdf`);
    const result = spawnSync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-pdf-header-footer',
        '--no-first-run',
        '--print-to-pdf=' + target,
        pathToFileURL(source).href,
      ],
      { encoding: 'utf8', timeout: 120_000 },
    );
    if (result.status !== 0 || !existsSync(target)) {
      throw new Error(`chromium failed for ${page}: ${result.stderr || result.stdout || result.error}`);
    }
    console.log(`chromium: ${path.basename(target)}`);
  }
}

async function buildWord() {
  if (!word) return console.log('word: Microsoft Word is not installed here, skipped');
  for (const mode of ['leak', 'clean']) {
    const target = path.join(OUT, mode === 'leak' ? 'word-paint-over.pdf' : 'word-clean-table.pdf');
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(SOURCES, 'word.ps1'), target, mode],
      { encoding: 'utf8', timeout: 180_000 },
    );
    if (result.status !== 0) throw new Error(`word failed (${mode}): ${result.stderr || result.stdout}`);
  }
  console.log('word: word-paint-over.pdf, word-clean-table.pdf');
}

async function buildReportLab() {
  if (!python) return console.log('reportlab: not installed for this Python, skipped');
  execFileSync(python, [path.join(SOURCES, 'make_reportlab.py'), OUT], { encoding: 'utf8', timeout: 120_000 });
  console.log('reportlab: reportlab-paint-over.pdf, reportlab-clean-invoice.pdf');
}

await mkdir(OUT, { recursive: true });

if (!only || only === 'chromium') {
  say('Chromium');
  await buildChromium();
}
if (!only || only === 'word') {
  say('Word');
  await buildWord();
}
if (!only || only === 'reportlab') {
  say('ReportLab');
  await buildReportLab();
}

// Never trust a regenerated file blindly: the manifest is the ground truth,
// and this is the cheapest place to notice that a producer changed its export.
say('verify against manifest');
let failed = 0;
for (const doc of manifest.documents) {
  const file = path.join(OUT, doc.file);
  if (!existsSync(file)) {
    console.log(`MISSING  ${doc.file} (producer not available here)`);
    failed++;
    continue;
  }
  const result = await analyzePdf(new Uint8Array(await readFile(file)), { showText: true });
  const hits = result.findings.filter((f) => f.covered.some((c) => c.text.includes(SECRET)));
  const kinds = new Set(result.findings.map((f) => f.kind));
  const ok =
    doc.expectedLeaks > 0
      ? doc.match === 'count'
        ? result.findings.length === doc.expectedLeaks
        : hits.length === doc.expectedLeaks
      : result.findings.length === 0;
  const kindsOk = !doc.expectedKinds || doc.expectedKinds.every((kind) => kinds.has(kind));
  if (!ok || !kindsOk) {
    failed++;
    console.log(
      `FAIL     ${doc.file}: expected ${doc.expectedLeaks} leak(s)${doc.expectedKinds ? ' ' + doc.expectedKinds.join('/') : ''}, got ${result.findings.length} (${[...kinds].join(', ') || 'none'})`,
    );
  } else {
    console.log(`ok       ${doc.file} (${result.findings.length} finding(s))`);
  }
}

if (failed) {
  console.error(`\n${failed} document(s) do not match the manifest`);
  process.exitCode = 1;
} else {
  console.log('\nall generated documents match the manifest');
}
