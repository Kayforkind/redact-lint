import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { parse } from 'yaml';
import { paintedOver } from './fixtures.mjs';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli.mjs');
const SWEEP = path.join(ROOT, 'scripts', 'sweep-issue.mjs');
const TITLE = 'redact-lint: PDFs contain painted-over text';

/** Runs the scanner on the leaky fixture and returns the report path. */
async function leakReport() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'redact-lint-sweep-'));
  const file = path.join(dir, 'leaky.pdf');
  await writeFile(file, await paintedOver());
  const report = path.join(dir, 'report.json');
  // The scanner exits 1 on a leak, so the shell keeps the JSON either way.
  await run('bash', ['-c', `"${process.execPath}" "${CLI}" --json "${file}" > "${report}" || true`], { cwd: dir });
  return report;
}

function mockServer(existing = []) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      calls.push({ method: req.method, path: url.pathname, query: url.search, body: body ? JSON.parse(body) : null });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && url.pathname.endsWith('/issues')) return res.end(JSON.stringify(existing));
      if (req.method === 'POST' && url.pathname.endsWith('/issues')) return res.end(JSON.stringify({ number: 42 }));
      if (req.method === 'POST') return res.end(JSON.stringify({ id: 7 }));
      return res.end(JSON.stringify({ number: 5 }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, calls, port: server.address().port }));
  });
}

async function sweep(port, report, extra = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, [SWEEP], {
      env: {
        ...process.env,
        GITHUB_API_URL: `http://127.0.0.1:${port}`,
        REPO: 'o/r',
        GH_TOKEN: 'test-token',
        REPORT: report,
        RUN_URL: 'https://example.test/run/1',
        ...extra,
      },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('opens one issue when a leak is found and none is open', async () => {
  const { server, calls, port } = await mockServer([]);
  try {
    const { code, stdout } = await sweep(port, await leakReport());
    assert.equal(code, 0, stdout);
    const created = calls.find((c) => c.method === 'POST' && c.path.endsWith('/issues'));
    assert.ok(created, 'expected an issue to be created');
    assert.equal(created.body.title, TITLE);
    assert.match(created.body.body, /1\*\* covered region across 1 PDF still contains/);
    assert.match(created.body.body, /paint-over/);
    assert.ok(!created.body.body.includes('123-45-6789'), 'issue body must stay masked');
    assert.match(created.body.body, /Sweep log: https:\/\/example\.test\/run\/1/);
  } finally {
    server.close();
  }
});

test('updates the open issue instead of opening a second one', async () => {
  const { server, calls, port } = await mockServer([{ number: 9, title: TITLE }]);
  try {
    const { code } = await sweep(port, await leakReport());
    assert.equal(code, 0);
    const patched = calls.find((c) => c.method === 'PATCH' && c.path.endsWith('/issues/9'));
    assert.ok(patched, 'expected the existing issue to be updated');
    assert.ok(!calls.some((c) => c.method === 'POST' && c.path.endsWith('/issues')), 'must not create a duplicate');
  } finally {
    server.close();
  }
});

test('closes the issue with a note once a scan is clean', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'redact-lint-sweep-'));
  const clean = path.join(dir, 'clean.json');
  await writeFile(clean, JSON.stringify({ version: '9.9.9', leaks: 0, files: [] }));
  const { server, calls, port } = await mockServer([{ number: 9, title: TITLE }]);
  try {
    const { code, stdout } = await sweep(port, clean);
    assert.equal(code, 0, stdout);
    assert.ok(calls.some((c) => c.method === 'POST' && c.path.endsWith('/issues/9/comments')), 'expected a closing comment');
    const closed = calls.find((c) => c.method === 'PATCH' && c.path.endsWith('/issues/9'));
    assert.equal(closed.body.state, 'closed');
    assert.equal(closed.body.state_reason, 'completed');
  } finally {
    server.close();
  }
});

test('does nothing when clean and no issue is open', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'redact-lint-sweep-'));
  const clean = path.join(dir, 'clean.json');
  await writeFile(clean, JSON.stringify({ version: '9.9.9', leaks: 0, files: [] }));
  const { server, calls, port } = await mockServer([]);
  try {
    const { code, stdout } = await sweep(port, clean);
    assert.equal(code, 0);
    assert.match(stdout, /no open issue/);
    assert.ok(!calls.some((c) => c.method !== 'GET'), 'a clean run must not write anything');
  } finally {
    server.close();
  }
});

test('sweep.yml runs weekly against every PDF and may write issues', async () => {
  const wf = parse(await readFile(path.join(ROOT, '.github', 'workflows', 'sweep.yml'), 'utf8'));
  assert.deepEqual(wf.on.schedule, [{ cron: '0 6 * * 1' }]);
  assert.equal(wf.permissions.issues, 'write');
  assert.equal(wf.permissions.contents, 'read');
  const scan = wf.jobs.sweep.steps.find((s) => s.id === 'scan');
  assert.equal(scan.with['changed-only'], false);
  assert.equal(scan['continue-on-error'], true, 'the issue step must still run after a failed scan');
  const issueStep = wf.jobs.sweep.steps.find((s) => s.name?.startsWith('Open, update or close'));
  assert.equal(issueStep.if, 'always()');
});
