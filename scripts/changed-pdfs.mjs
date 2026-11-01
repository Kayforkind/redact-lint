#!/usr/bin/env node
/**
 * Prints one PDF path per line for the action to scan.
 *
 * Order of preference:
 *   1. PDF_FILES          explicit list (used by the action's tests, and handy
 *                         when you want to lint a fixed set)
 *   2. pull request diff  files the PR added or modified, via the GitHub API —
 *                         no `fetch-depth: 0` checkout needed
 *   3. paths input        glob match over the working tree
 *
 * Only files that exist on disk are printed: a PR that deletes a PDF should not
 * fail because the scanner cannot open it.
 */
import { readFileSync, statSync } from 'node:fs';
import { globToRegExp, walk } from '../src/glob.mjs';

const env = process.env;
const out = [];

function emit(list) {
  const seen = new Set();
  for (const file of list) {
    const clean = String(file).trim().replace(/^\.\//, '');
    if (!clean || seen.has(clean)) continue;
    if (!/\.pdf$/i.test(clean)) continue;
    try {
      if (!statSync(clean).isFile()) continue;
    } catch {
      continue;
    }
    seen.add(clean);
    out.push(clean);
  }
}

if (env.PDF_FILES) {
  emit(env.PDF_FILES.split(/[\n,]+/));
} else if (env.INPUT_CHANGED_ONLY !== 'false' && prNumber(env)) {
  emit(await pullRequestFiles(env));
} else {
  const patterns = (env.INPUT_PATHS || '**/*.pdf')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map(globToRegExp);
  emit(walk('.').filter((file) => patterns.some((re) => re.test(file))));
}

process.stdout.write(out.join('\n') + (out.length ? '\n' : ''));

function prNumber(env) {
  try {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH || '', 'utf8'));
    return event.pull_request?.number ?? null;
  } catch {
    return null;
  }
}

async function pullRequestFiles(env) {
  const [owner, repo] = (env.GITHUB_REPOSITORY || '').split('/');
  const number = prNumber(env);
  if (!owner || !repo || !number) return [];
  const api = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const url = `${api}/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${env.RL_TOKEN || env.GITHUB_TOKEN || ''}`,
        'user-agent': 'redact-lint-action',
      },
    });
    if (!res.ok) {
      console.error(`redact-lint: could not list PR files (${res.status} ${res.statusText})`);
      process.exitCode = 2;
      return files;
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const f of batch) {
      if (f.status === 'removed') continue;
      files.push(f.filename);
    }
    if (batch.length < 100) break;
  }
  return files;
}
