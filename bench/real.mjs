/**
 * The real-producer half of the corpus.
 *
 * These PDFs were exported by software people actually use — Chrome, Word,
 * ReportLab — with one known leak planted (or a deliberate clean layout) and
 * committed under bench/real/pdfs. CI scores them without installing any of
 * that software; `node bench/real/make.mjs` regenerates them and checks the
 * result against bench/real/manifest.json.
 *
 * They are here because generated fixtures test what pdf-lib emits, and a
 * detector tuned to one producer's operator order is a detector that only
 * works on its own files. Word, for instance, splits a hyphenated SSN into
 * several runs and emits space-only text operators; Chromium interleaves
 * background fills with table text.
 *
 * `match: "count"` means the ground truth is the number of findings, not the
 * presence of the exact SECRET string: Word splits that string across runs,
 * and requiring one run to contain it would fail a correct detection.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function buildRealCorpus() {
  const manifest = JSON.parse(await readFile(path.join(HERE, 'real', 'manifest.json'), 'utf8'));
  const docs = [];

  for (const entry of manifest.documents) {
    const bytes = new Uint8Array(await readFile(path.join(HERE, 'real', 'pdfs', entry.file)));
    docs.push({
      name: `real/${entry.file.replace(/\.pdf$/, '')}`,
      class: entry.class,
      producer: entry.producer,
      producerVersion: entry.producerVersion,
      expectedLeaks: entry.expectedLeaks,
      expectedKinds: entry.expectedKinds || null,
      match: entry.match || 'count',
      note: entry.what,
      bytes,
    });
  }

  return docs;
}
