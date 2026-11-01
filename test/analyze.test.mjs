import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePdf, maskText } from '../src/analyze.mjs';
import {
  SECRET, paintedOver, paintedOverRotated, whiteout, trulyRedacted, cleanDocument, highlightedPanel, realisticReport,
} from './fixtures.mjs';

test('flags text under a black bar painted after it', async () => {
  const result = await analyzePdf(await paintedOver(), { showText: true });
  assert.equal(result.summary.leaks, 1);
  const [finding] = result.findings;
  assert.equal(finding.page, 1);
  assert.equal(finding.kind, 'paint-over');
  assert.equal(finding.fill.color, '#000000');
  const texts = finding.covered.map((c) => c.text);
  assert.deepEqual(texts, [SECRET]);
  assert.ok(finding.covered[0].coverage >= 0.9, `expected near-total coverage, got ${finding.covered[0].coverage}`);
});

test('flags whiteout over text as a leak too', async () => {
  const result = await analyzePdf(await whiteout(), { showText: true });
  assert.equal(result.summary.leaks, 1);
  assert.equal(result.findings[0].kind, 'whiteout');
  assert.deepEqual(result.findings[0].covered.map((c) => c.text), [SECRET]);
});

test('finds the same leak on a rotated page', async () => {
  const result = await analyzePdf(await paintedOverRotated(), { showText: true });
  assert.equal(result.summary.leaks, 1);
  assert.deepEqual(result.findings[0].covered.map((c) => c.text), [SECRET]);
});

test('does not flag a bar where the text was actually removed', async () => {
  const result = await analyzePdf(await trulyRedacted());
  assert.deepEqual(result.findings, []);
  assert.equal(result.summary.leaks, 0);
});

test('does not flag a full-page background under body text', async () => {
  const result = await analyzePdf(await cleanDocument());
  assert.deepEqual(result.findings, []);
});

test('does not flag a highlight panel painted before its text', async () => {
  const result = await analyzePdf(await highlightedPanel(), { showText: true });
  assert.deepEqual(result.findings, []);
});

test('stays quiet on a realistic 3-page report (no false positives)', async () => {
  const result = await analyzePdf(await realisticReport());
  assert.equal(result.pages, 3);
  assert.deepEqual(result.findings, [], JSON.stringify(result.findings.slice(0, 2), null, 2));
});

test('masks covered text in the report by default', async () => {
  const result = await analyzePdf(await paintedOver());
  const [covered] = result.findings[0].covered;
  assert.ok(!covered.text.includes('123-45-6789'), 'masked output must not contain the secret');
  assert.equal(covered.text.length, SECRET.length);
});

test('maskText keeps the first two characters only', () => {
  assert.equal(maskText('ABCDEFG'), 'AB•••••');
});
