#!/usr/bin/env node
/**
 * redact-lint CLI.
 *
 *   redact-lint report.pdf                 human output, exit 1 on leaks
 *   redact-lint *.pdf --json               machine output for CI
 *   redact-lint report.pdf --show-text     print the leaked text (local only)
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { analyzePdf, EncryptedPdfError } from './analyze.mjs';
import { applyWaivers, loadIgnore } from './ignore.mjs';
import { toSarif } from './sarif.mjs';

// Single source of truth. A hardcoded copy drifts on the first release bump,
// and --version is exactly what people quote in a bug report.
const VERSION = createRequire(import.meta.url)('../package.json').version;

const HELP = `redact-lint ${VERSION} — catch redaction that only paints over text

usage
  redact-lint <file.pdf...> [options]

options
  --json        machine-readable output (one object per file)
  --show-text   print covered text instead of masking it
  --min-coverage <0-1>   how much of a text run a cover must span (default 0.6)
  --annotations list annotation and form-field text (not a leak on its own)
  --password <pw>       password for an encrypted PDF
  --sarif       SARIF 2.1.0 output for code scanning
  --ignore-file <path>  waivers (default: .redactlintignore if present)
  -h, --help    this text
  -v, --version print version

exit codes
  0  no leaks found
  1  at least one text run is hidden under a cover but still extractable
  2  usage or read/parse error
  3  the PDF is encrypted and no usable password was given

why
  A black box only redacts if the text underneath was removed. Same box drawn
  over live text looks identical on screen and leaks the content to anyone who
  selects, copies or extracts it. This tool checks the painted order.`;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
const red = (s) => paint('31', s);
const dim = (s) => paint('2', s);
const bold = (s) => paint('1', s);

function parseArgs(argv) {
  const files = [];
  const opts = { json: false, showText: false, minCoverage: undefined, annotations: false, password: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { help: true };
    if (a === '-v' || a === '--version') return { version: true };
    if (a === '--json') opts.json = true;
    else if (a === '--show-text') opts.showText = true;
    else if (a === '--annotations') opts.annotations = true;
    else if (a === '--sarif') opts.sarif = true;
    else if (a === '--ignore-file') {
      const v = argv[++i];
      if (v === undefined) return { error: '--ignore-file needs a path' };
      opts.ignoreFile = v;
    } else if (a === '--password') {
      const v = argv[++i];
      if (v === undefined) return { error: '--password needs a value' };
      opts.password = v;
    }
    else if (a === '--min-coverage') {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0 || v > 1) return { error: '--min-coverage needs a number between 0 and 1' };
      opts.minCoverage = v;
    } else if (a.startsWith('-') && a !== '-') return { error: `unknown option ${a}` };
    else files.push(a);
  }
  return { files, opts };
}

function render(result, file, opts) {
  const lines = [];
  const hits = result.findings;
  lines.push(`${hits.length ? red('LEAK') : paint('32', 'OK  ')}  ${bold(file)}`);

  for (const f of hits) {
    const fill = f.fill;
    const cover = fill.type === 'image' ? 'image' : fill.color;
    lines.push(`  page ${f.page}  ${red(f.kind)}  ${cover} ${fill.w}×${fill.h}pt`);
    for (const run of f.covered) {
      lines.push(`    "${run.text}"  ${dim(`still extractable, ${Math.round(run.coverage * 100)}% covered`)}`);
    }
  }

  const notes = result.notes || [];
  if (notes.length) {
    lines.push(dim(`  ${notes.length} note${notes.length === 1 ? '' : 's'} in annotations or form fields`));
    for (const note of notes.slice(0, 8)) {
      const where = note.page ? `p${note.page} ` : '';
      const label = note.label ? ` "${note.label}"` : '';
      lines.push(`    ${where}${note.kind}${label}: "${note.text}"`);
    }
    if (notes.length > 8) lines.push(dim(`    ${notes.length - 8} more`));
  }

  lines.push('');
  const p = result.pages === 1 ? 'page' : 'pages';
  const r = result.textRuns === 1 ? 'text run' : 'text runs';
  const verdict = hits.length ? red(`${hits.length} leak${hits.length === 1 ? '' : 's'}`) : paint('32', 'no leaks');
  const notePart = notes.length ? ` · ${notes.length} note${notes.length === 1 ? '' : 's'}` : '';
  lines.push(dim(`${result.pages} ${p} · ${result.textRuns} ${r}${notePart} · ${verdict}`));
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(HELP);
  if (args.version) return console.log(VERSION);
  if (args.error) {
    console.error(`redact-lint: ${args.error}`);
    console.error('try: redact-lint --help');
    process.exitCode = 2;
    return;
  }
  if (!args.files.length) {
    console.error(HELP);
    process.exitCode = 2;
    return;
  }

  const reports = [];
  let failed = false;
  let leaks = 0;
  let status = 0;
  let suppressed = 0;

  let rules = [];
  try {
    rules = args.opts.ignoreFile ? loadIgnore(args.opts.ignoreFile) : loadIgnore('.redactlintignore');
  } catch (err) {
    console.error(`redact-lint: ${args.opts.ignoreFile || '.redactlintignore'}: ${err?.message || err}`);
    process.exitCode = 2;
    return;
  }

  for (const file of args.files) {
    try {
      const bytes = await readFile(file);
      const analyzed = await analyzePdf(bytes, {
        showText: args.opts.showText,
        minCoverage: args.opts.minCoverage,
        annotations: args.opts.annotations,
        password: args.opts.password,
      });
      const { result, waived } = applyWaivers(analyzed, file, rules);
      suppressed += waived.length;
      leaks += result.summary.leaks;
      reports.push({ file, ...result });
      if (result.summary.leaks) failed = true;
      if (!args.opts.json && !args.opts.sarif) {
        console.log(render(result, path.basename(file), args.opts));
        if (waived.length) {
          console.log(dim(`  ${waived.length} finding${waived.length === 1 ? '' : 's'} waived`));
          for (const w of waived.slice(0, 5)) console.log(dim(`    ${w.rule}: ${w.reason}`));
        }
      }
    } catch (err) {
      failed = true;
      if (err instanceof EncryptedPdfError) {
        status = Math.max(status, 3);
        console.error(`redact-lint: ${file}: encrypted — pass --password to open it`);
      } else {
        status = Math.max(status, 2);
        console.error(`redact-lint: ${file}: ${err?.message || err}`);
      }
    }
  }

  if (args.opts.sarif) {
    console.log(JSON.stringify(toSarif(reports, VERSION), null, 2));
  } else if (args.opts.json) {
    console.log(JSON.stringify({ version: VERSION, leaks, suppressed, files: reports }, null, 2));
  } else if (args.files.length > 1) {
    const files = reports.length;
    console.log(failed ? red(`${leaks} leak${leaks === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}`) : paint('32', `clean: ${files} files`));
  }

  if (status === 0 && failed) status = 1;
  process.exitCode = status;
}

main().catch((err) => {
  console.error(`redact-lint: ${err?.stack || err}`);
  process.exitCode = 2;
});
