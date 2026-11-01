# Real-producer corpus

Eight PDFs exported by software people actually use, with ground truth in
[`manifest.json`](manifest.json). CI scores them on every run; the software is
not needed to run the benchmark.

| Producer | Documents | What they exercise |
| --- | --- | --- |
| Chrome 156 (headless print) | paint-over, whiteout, image cover, clean report | Positioned backgrounds emitted after body text; one line split across several operators |
| Microsoft Word 16 | paint-over, clean table | Shape exported in front of text; interleaved cell fills and cell text operators |
| ReportLab 5.0 | paint-over, clean invoice | Text and rectangles in call order; row shading before its text |

## Why they are committed

A corpus that exists only on the machine that built it is a claim, not a test.
Committing the PDFs means the same bytes are scored on Linux, macOS and Windows
in CI, and a detector change that breaks one producer is visible immediately.

They are fixtures, not a sample of published documents. Each one has a single
planted leak, or a deliberately clean layout. Real filings are messier; they
are also confidential, which is why they are not here.

## Regenerating

```bash
node bench/real/make.mjs              # build with whatever is installed
node bench/real/make.mjs --only word  # one producer
```

The script builds each document with the producer if it can find it, then
verifies every file against the manifest and exits non-zero on a mismatch.
Producers that are not installed are skipped with a message.

Sources are in [`sources/`](sources):

- `paint-over.html`, `whiteout.html`, `image-cover.html`, `clean-report.html` —
  printed with `chrome --headless=new --no-pdf-header-footer --print-to-pdf`
- `word.ps1` — drives Word over COM (`leak` and `clean` modes). Windows only:
  Word has no headless export on other platforms.
- `make_reportlab.py` — writes the two ReportLab documents. The file is not
  called `reportlab.py` on purpose: a script with that name shadows the package
  it imports.

## Adding a document

1. Put the PDF in `pdfs/`, named `<producer>-<case>.pdf`.
2. Add an entry to `manifest.json` with `class`, `expectedLeaks`,
   `expectedKinds` (for positives), the producer and version, and one line
   describing what it exercises.
3. Run `npm run bench:check`. If the detector gets it wrong, you have found a
   real failure — write it down before changing a threshold.
4. Add the source under `sources/` if it can be regenerated on other machines.

Use `"match": "count"` when the producer splits the secret across text runs
(Word breaks a hyphenated number at each hyphen), so the score is the number of
findings rather than one run containing the whole string.
