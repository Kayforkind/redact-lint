import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePdf, EncryptedPdfError } from '../src/analyze.mjs';
import {
  SECRET, imageCover, imageBehindText, formWithValue, pdfkitLeak, encrypted,
} from './fixtures.mjs';

test('flags a bitmap pasted over live text', async () => {
  const result = await analyzePdf(await imageCover(), { showText: true });
  assert.equal(result.summary.leaks, 1);
  const [finding] = result.findings;
  assert.equal(finding.kind, 'image-cover');
  assert.equal(finding.fill.type, 'image');
  assert.equal(finding.fill.color, null, 'an image has no fill colour');
  assert.deepEqual(finding.covered.map((c) => c.text), [SECRET]);
});

test('does not flag an image painted before its text', async () => {
  const result = await analyzePdf(await imageBehindText());
  assert.deepEqual(result.findings, []);
});

test('collects form-field values only when asked', async () => {
  const quiet = await analyzePdf(await formWithValue());
  assert.deepEqual(quiet.notes, [], 'form text is opt-in');

  const verbose = await analyzePdf(await formWithValue(), { annotations: true, showText: true });
  assert.equal(verbose.summary.leaks, 0);
  assert.ok(verbose.notes.some((n) => n.kind === 'form-field' && n.text.includes('Jane Q. Public')));
});

test('refuses an encrypted PDF with a typed error', async () => {
  await assert.rejects(analyzePdf(await encrypted()), (err) => {
    assert.ok(err instanceof EncryptedPdfError);
    assert.equal(err.name, 'EncryptedPdfError');
    return true;
  });
});

test('opens an encrypted PDF with the right password, then finds the leak', async () => {
  const result = await analyzePdf(await encrypted('secret'), { password: 'secret', showText: true });
  assert.equal(result.pages, 1);
  assert.equal(result.summary.leaks, 1);
  assert.deepEqual(result.findings[0].covered.map((c) => c.text), [SECRET]);
});

test('detects a painted-over leak from a different PDF producer', async () => {
  const result = await analyzePdf(await pdfkitLeak(), { showText: true });
  assert.equal(result.summary.leaks, 1);
  assert.equal(result.findings[0].kind, 'paint-over');
  assert.deepEqual(result.findings[0].covered.map((c) => c.text), [SECRET]);
});

test('does not flag a rejectable image when it is page-sized', async () => {
  // A full-page scanned image behind OCR text is a normal document, not a leak.
  const result = await analyzePdf(await formWithValue());
  assert.deepEqual(result.findings, []);
});
