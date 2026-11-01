import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { parse } from 'yaml';
import { paintedOver, trulyRedacted } from './fixtures.mjs';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli.mjs');
const SELECT = path.join(ROOT, 'scripts', 'changed-pdfs.mjs');
const ACTION = path.join(ROOT, 'scripts', 'run.sh');

async function workdir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'redact-lint-action-'));
  await writeFile(path.join(dir, 'leaky.pdf'), await paintedOver());
  await writeFile(path.join(dir, 'clean.pdf'), await trulyRedacted());
  return dir;
}

async function sh(file, args, { cwd, env = {} }) {
  try {
    const { stdout, stderr } = await run(file, args, { cwd, env: { ...process.env, NO_COLOR: '1', ...env } });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('action.yml is a valid composite action wired to the scripts', async () => {
  const meta = parse(await readFile(path.join(ROOT, 'action.yml'), 'utf8'));
  assert.equal(meta.runs.using, 'composite');
  assert.ok(meta.description.length > 20);
  for (const [name, input] of Object.entries(meta.inputs)) {
    assert.ok(input.description, `input ${name} needs a description`);
  }
  for (const [name, output] of Object.entries(meta.outputs)) {
    assert.match(output.value, /^\$\{\{\s*steps\.scan\.outputs\./, `output ${name} must map a step output`);
  }
  const [step] = meta.runs.steps;
  assert.equal(step.shell, 'bash');
  assert.match(step.run, /GITHUB_ACTION_PATH/);
  assert.equal(meta.inputs.version.default, JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')).version);
});

test('selects only existing PDFs from an explicit list', async () => {
  const cwd = await workdir();
  const { stdout } = await sh(process.execPath, [SELECT], {
    cwd,
    env: { PDF_FILES: 'leaky.pdf, clean.pdf, missing.pdf, notes.txt' },
  });
  assert.deepEqual(stdout.trim().split('\n').sort(), ['clean.pdf', 'leaky.pdf']);
});

test('glob mode finds nested PDFs and skips node_modules', async () => {
  const cwd = await workdir();
  await mkdir(path.join(cwd, 'docs', 'nested'), { recursive: true });
  await mkdir(path.join(cwd, 'node_modules', 'pkg'), { recursive: true });
  const bytes = await trulyRedacted();
  await writeFile(path.join(cwd, 'docs', 'nested', 'a.pdf'), bytes);
  await writeFile(path.join(cwd, 'node_modules', 'pkg', 'b.pdf'), bytes);
  const { stdout } = await sh(process.execPath, [SELECT], {
    cwd,
    env: { INPUT_CHANGED_ONLY: 'false', INPUT_PATHS: '**/*.pdf' },
  });
  const files = stdout.trim().split('\n');
  assert.ok(files.includes('docs/nested/a.pdf'), 'nested PDF should be found');
  assert.ok(!files.some((f) => f.includes('node_modules')), 'node_modules must be skipped');
});

test('action fails the step on a leak and reports outputs', async () => {
  const cwd = await workdir();
  const temp = await mkdtemp(path.join(os.tmpdir(), 'redact-lint-out-'));
  const outputFile = path.join(temp, 'output');
  const summaryFile = path.join(temp, 'summary');
  await writeFile(outputFile, '');
  await writeFile(summaryFile, '');
  const { code, stdout } = await sh('bash', [ACTION], {
    cwd,
    env: {
      GITHUB_ACTION_PATH: ROOT,
      RUNNER_TEMP: temp,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      RL_CLI: CLI,
      PDF_FILES: 'leaky.pdf, clean.pdf',
      INPUT_FAIL_ON: 'leak',
    },
  });
  assert.equal(code, 1, stdout);
  const outputs = await readFile(outputFile, 'utf8');
  assert.match(outputs, /^leaks=1$/m);
  assert.match(outputs, /^files=2$/m);
  const summary = await readFile(summaryFile, 'utf8');
  assert.match(summary, /1 leak/);
  assert.match(summary, /paint-over/);
  assert.ok(!summary.includes('123-45-6789'), 'summary must stay masked');
});

test('action passes when every PDF is genuinely redacted', async () => {
  const cwd = await workdir();
  const temp = await mkdtemp(path.join(os.tmpdir(), 'redact-lint-out-'));
  const outputFile = path.join(temp, 'output');
  await writeFile(outputFile, '');
  const { code } = await sh('bash', [ACTION], {
    cwd,
    env: {
      GITHUB_ACTION_PATH: ROOT,
      RUNNER_TEMP: temp,
      GITHUB_OUTPUT: outputFile,
      RL_CLI: CLI,
      PDF_FILES: 'clean.pdf',
    },
  });
  assert.equal(code, 0);
  assert.match(await readFile(outputFile, 'utf8'), /^leaks=0$/m);
});

test('fail-on: never reports without failing the check', async () => {
  const cwd = await workdir();
  const temp = await mkdtemp(path.join(os.tmpdir(), 'redact-lint-out-'));
  const { code, stdout } = await sh('bash', [ACTION], {
    cwd,
    env: {
      GITHUB_ACTION_PATH: ROOT,
      RUNNER_TEMP: temp,
      RL_CLI: CLI,
      PDF_FILES: 'leaky.pdf',
      INPUT_FAIL_ON: 'never',
    },
  });
  assert.equal(code, 0, stdout);
  assert.match(stdout, /warning/i);
});

test('action is a no-op when no PDFs match', async () => {
  const cwd = await workdir();
  const temp = await mkdtemp(path.join(os.tmpdir(), 'redact-lint-out-'));
  const { code, stdout } = await sh('bash', [ACTION], {
    cwd,
    env: {
      GITHUB_ACTION_PATH: ROOT,
      RUNNER_TEMP: temp,
      RL_CLI: CLI,
      PDF_FILES: 'missing.pdf',
    },
  });
  assert.equal(code, 0);
  assert.match(stdout, /no PDFs to scan/i);
});
