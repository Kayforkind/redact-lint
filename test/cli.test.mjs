import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { paintedOver, trulyRedacted } from './fixtures.mjs';

const run = promisify(execFile);
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.mjs');

async function writeFixture(bytes, name) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'redact-lint-'));
  const file = path.join(dir, name);
  await writeFile(file, bytes);
  return file;
}

async function cli(args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { env: { ...process.env, NO_COLOR: '1' } });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('exits 1 and reports the leak for a painted-over PDF', async () => {
  const file = await writeFixture(await paintedOver(), 'leaky.pdf');
  const { code, stdout } = await cli([file]);
  assert.equal(code, 1);
  assert.match(stdout, /LEAK/);
  assert.match(stdout, /paint-over/);
  assert.ok(!stdout.includes('123-45-6789'), 'default output must be masked');
});

test('--show-text prints the covered text', async () => {
  const file = await writeFixture(await paintedOver(), 'leaky.pdf');
  const { stdout } = await cli([file, '--show-text']);
  assert.match(stdout, /123-45-6789/);
});

test('--json is parseable and carries the finding', async () => {
  const file = await writeFixture(await paintedOver(), 'leaky.pdf');
  const { code, stdout } = await cli([file, '--json']);
  assert.equal(code, 1);
  const report = JSON.parse(stdout);
  assert.equal(report.leaks, 1);
  assert.equal(report.files[0].findings[0].kind, 'paint-over');
});

test('exits 0 for a properly redacted PDF', async () => {
  const file = await writeFixture(await trulyRedacted(), 'clean.pdf');
  const { code, stdout } = await cli([file]);
  assert.equal(code, 0);
  assert.match(stdout, /OK/);
});

test('exits 2 when a file cannot be read', async () => {
  const { code, stderr } = await cli(['does-not-exist.pdf']);
  assert.equal(code, 2);
  assert.match(stderr, /cannot read|ENOENT/i);
});
