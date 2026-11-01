import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { analyzePdf } from '../src/analyze.mjs';
import { buildRealCorpus } from '../bench/real.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, '..', 'bench', 'real', 'manifest.json');
const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));

const byFile = new Map(await Promise.all(
  (await buildRealCorpus()).map(async (doc) => [doc.name.replace('real/', '') + '.pdf', await analyzePdf(doc.bytes)]),
));

for (const doc of manifest.documents) {
  test(`real producer: ${doc.file}`, () => {
    const result = byFile.get(doc.file);
    assert.ok(result, `${doc.file} is in the manifest but was not analysed`);
    assert.equal(result.summary.leaks, doc.expectedLeaks, `${doc.file}: finding count`);
    for (const kind of doc.expectedKinds || []) {
      assert.ok(result.findings.some((f) => f.kind === kind), `${doc.file}: expected a ${kind}`);
    }
  });
}

// Regression: Word interleaves cell fills with cell text. Pairing runs to
// text operators by ordinal made the header shading look like a cover painted
// after the cell text, so a clean table produced four false positives.
test('Word table shading stays silent', async () => {
  const result = byFile.get('word-clean-table.pdf');
  assert.equal(result.findings.length, 0);
});
