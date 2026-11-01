#!/usr/bin/env node
/**
 * Keeps one issue in sync with the scheduled sweep.
 *
 * A leak that persists should not spawn a new issue every week, and a fixed
 * one should not leave a stale warning open. So: create if missing, update in
 * place while leaks exist, close (with a note) once a run comes back clean.
 *
 * Env: REPORT, REPO, GH_TOKEN, GITHUB_API_URL, RUN_URL, DRY_RUN
 */
import { existsSync, readFileSync } from 'node:fs';

const TITLE = 'redact-lint: PDFs contain painted-over text';
const MAX_ROWS = 50;

const REPORT = process.env.REPORT;
const REPO = process.env.REPO;
const TOKEN = process.env.GH_TOKEN;
const API = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const RUN_URL = process.env.RUN_URL || '';
const DRY_RUN = process.env.DRY_RUN === 'true';

const raw = REPORT && existsSync(REPORT) ? readFileSync(REPORT, 'utf8').trim() : '';
const report = raw ? JSON.parse(raw) : { leaks: 0, files: [], version: null };

const leaks = Number(report.leaks || 0);
const files = report.files || [];

const rows = [];
for (const file of files) {
  for (const finding of file.findings || []) {
    for (const run of finding.covered) {
      rows.push(
        `| \`${file.file}\` | ${finding.page} | ${finding.kind} | ${finding.fill.color} ${finding.fill.w}×${finding.fill.h}pt | \`${run.text}\` | ${Math.round(run.coverage * 100)}% |`,
      );
    }
  }
}

const title = TITLE;
const body = leaks > 0 ? leakBody() : null;

async function main() {
  const existing = await findOpenIssue();
  if (leaks > 0) {
    if (existing) {
      await patch(existing.number, { body });
      log(`updated issue #${existing.number}`);
    } else {
      const created = await post('issues', { title, body });
      log(`opened issue #${created.number}`);
    }
    return;
  }
  if (existing) {
    await post(`issues/${existing.number}/comments`, {
      body: 'The latest sweep found no covered text that is still extractable. Closing.',
    });
    await patch(existing.number, { state: 'closed', state_reason: 'completed' });
    log(`closed issue #${existing.number}`);
    return;
  }
  log('clean, and no open issue to close');
}

function leakBody() {
  const scanned = files.length;
  const truncated = rows.length > MAX_ROWS;
  const one = leaks === 1;
  const lines = [
    `**${leaks}** covered region${one ? '' : 's'} across ${scanned} PDF${scanned === 1 ? '' : 's'} still ${one ? 'contains' : 'contain'} extractable text.`,
    '',
    'A rectangle only redacts if the text underneath was removed. These runs are covered but still in the file:',
    '',
    '| File | Page | Kind | Fill | Covered text | Coverage |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.slice(0, MAX_ROWS),
    '',
  ];
  if (truncated) lines.push(`_${rows.length - MAX_ROWS} more finding(s) omitted; see the run log._`, '');
  lines.push(
    'Re-export with real redaction (content deleted) instead of drawing a shape on top. Text is masked here; run `npx redact-lint <file> --show-text` locally to review it.',
    '',
  );
  if (RUN_URL) lines.push(`Sweep log: ${RUN_URL}`, '');
  lines.push(
    `<sub>This issue is maintained by the scheduled sweep (workflow \`sweep.yml\`). It is updated in place while leaks exist and closed automatically when a clean run finishes. Scanned with redact-lint ${report.version || 'unknown'}.</sub>`,
  );
  return lines.join('\n');
}

async function findOpenIssue() {
  for (let page = 1; page <= 5; page++) {
    const list = await get(`issues?state=open&per_page=100&page=${page}`);
    const hit = list.find((issue) => !issue.pull_request && issue.title === TITLE);
    if (hit) return hit;
    if (list.length < 100) return null;
  }
  return null;
}

async function request(path, init = {}) {
  if (DRY_RUN && init.method && init.method !== 'GET') {
    log(`dry run: ${init.method} ${path}`);
    return {};
  }
  const res = await fetch(`${API}/repos/${REPO}/${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'redact-lint-sweep',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${res.statusText}: ${detail.slice(0, 300)}`);
  }
  return res.status === 204 ? {} : res.json();
}

const get = (path) => request(path);
const post = (path, payload) => request(path, { method: 'POST', body: JSON.stringify(payload) });
const patch = (pathOrNumber, payload) =>
  request(`issues/${pathOrNumber}`, { method: 'PATCH', body: JSON.stringify(payload) });

function log(message) {
  console.log(`redact-lint sweep: ${message}`);
}

main().catch((err) => {
  console.error(`redact-lint sweep: ${err.message}`);
  process.exitCode = 1;
});
