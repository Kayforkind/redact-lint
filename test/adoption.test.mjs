import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { parse } from 'yaml';
import { analyzePdf } from '../src/analyze.mjs';
import { applyWaivers, parseIgnore } from '../src/ignore.mjs';
import { toSarif } from '../src/sarif.mjs';
import { paintedOver } from './fixtures.mjs';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli.mjs');

async function cli(cwd, args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: '1' } });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function dirWithLeak() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'redact-lint-adopt-'));
  await writeFile(path.join(dir, 'leaky.pdf'), await paintedOver());
  return dir;
}

test('waiver rules need a reason', () => {
  assert.throws(() => parseIgnore('docs/*.pdf'), /needs a reason/);
  const rules = parseIgnore('docs/*.pdf  # scanned before 2019\nreport.pdf:3 # divider page');
  assert.equal(rules.length, 2);
  assert.equal(rules[0].reason, 'scanned before 2019');
  assert.equal(rules[1].page, 3);
});

test('a page-specific waiver hides only that page', async () => {
  const result = await analyzePdf(await paintedOver());
  const pageSpecific = applyWaivers(result, 'leaky.pdf', parseIgnore('*.pdf:2 # other page'));
  assert.equal(pageSpecific.waived.length, 0, 'page 2 is not the leaking page');

  const allPages = applyWaivers(result, 'leaky.pdf', parseIgnore('*.pdf # investigated'));
  assert.equal(allPages.result.summary.leaks, 0);
  assert.equal(allPages.result.summary.suppressed, 1);
  assert.equal(allPages.waived[0].reason, 'investigated');
});

test('CLI honours .redactlintignore and reports what it hid', async () => {
  const dir = await dirWithLeak();
  await writeFile(path.join(dir, '.redactlintignore'), 'leaky.pdf # accepted risk, ticket SEC-14\n');
  const { code, stdout } = await cli(dir, ['leaky.pdf']);
  assert.equal(code, 0);
  assert.match(stdout, /waived/);
  assert.match(stdout, /SEC-14/);
});

test('CLI rejects an ignore file with an unreasoned rule', async () => {
  const dir = await dirWithLeak();
  await writeFile(path.join(dir, 'waivers.txt'), 'leaky.pdf\n');
  const { code, stderr } = await cli(dir, ['leaky.pdf', '--ignore-file', 'waivers.txt']);
  assert.equal(code, 2);
  assert.match(stderr, /needs a reason/);
});

test('SARIF output is well formed and points at the file', async () => {
  const dir = await dirWithLeak();
  const { code, stdout } = await cli(dir, ['leaky.pdf', '--sarif']);
  assert.equal(code, 1, 'a leak still fails the run');
  const sarif = JSON.parse(stdout);
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs.length, 1);
  const [{ tool, results }] = sarif.runs;
  assert.equal(tool.driver.name, 'redact-lint');
  assert.ok(tool.driver.rules.some((r) => r.id === 'paint-over'));
  assert.equal(results.length, 1);
  assert.equal(results[0].ruleId, 'paint-over');
  assert.equal(results[0].level, 'error');
  assert.equal(results[0].locations[0].physicalLocation.artifactLocation.uri, 'leaky.pdf');
  assert.equal(results[0].properties.page, 1);
  assert.ok(!stdout.includes('123-45-6789'), 'SARIF must stay masked');
});

test('toSarif reports one result per finding', () => {
  const sarif = toSarif(
    [{ file: 'a.pdf', findings: [{ page: 2, kind: 'image-cover', fill: { type: 'image', color: null, x: 1, y: 2, w: 3, h: 4 }, covered: [{ text: 'SS•••', coverage: 0.9, box: {} }] }] }],
    '9.9.9',
  );
  assert.equal(sarif.runs[0].tool.driver.version, '9.9.9');
  assert.equal(sarif.runs[0].results[0].properties.cover.type, 'image');
});

test('the action exposes the waiver file input', async () => {
  const meta = parse(await readFile(path.join(ROOT, 'action.yml'), 'utf8'));
  assert.ok(meta.inputs['ignore-file']);
  assert.equal(meta.inputs['ignore-file'].default, '');
});
