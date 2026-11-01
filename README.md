# redact-lint

[![CI](https://github.com/Kayforkind/redact-lint/actions/workflows/ci.yml/badge.svg)](https://github.com/Kayforkind/redact-lint/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/redact-lint.svg)](https://www.npmjs.com/package/redact-lint)

Catch fake redaction before the file leaves your machine.

A black box only redacts if the text underneath was deleted. Draw the same box
over live text and the page looks identical — but the content is still in the
file, ready to be selected, copied, or extracted by anyone who receives it.
This is one of the oldest recurring leaks in publishing, and it is invisible to
the person who made it.

`redact-lint` reads the PDF the way a viewer does, then asks a different
question: **was that rectangle painted after the text it covers?**

```
$ redact-lint disclosure.pdf

LEAK  disclosure.pdf
  page 1  paint-over  #000000 190×22pt
    "SS•••••••••••••"  still extractable, 100% covered

1 page · 4 text runs · 1 leak
```

Exit code `1` stops a CI job. Covered text is masked by default because this
output ends up in build logs and pasted into tickets.

## Why this exists

Redaction instructions usually say "cover it with a black rectangle". In a
vector PDF that instruction is ambiguous: you can cover ink, or you can cover
*and remove* content. Most tools do the first. The result looks safe and is not.

The failure is not exotic — it is the default outcome of drawing a shape on a
page. Every year, published documents are found with names, addresses and
account numbers still extractable under a box. `redact-lint` is a check you can
run on every PDF your team publishes, in one second, with no upload.

Longer write-up, including the CI setup: [docs/launch-post.md](docs/launch-post.md).
How the detector works, operator by operator: [docs/algorithm.md](docs/algorithm.md).
Measured detection rates and their limits: [BENCHMARK.md](BENCHMARK.md).
Project status and what is missing: [docs/plan.md](docs/plan.md).

## Usage

```bash
npx redact-lint report.pdf                  # human output, exits 1 on leaks
npx redact-lint *.pdf --json                # machine-readable, for CI
npx redact-lint report.pdf --show-text      # print the covered text (local only)
npx redact-lint report.pdf --min-coverage 0.5
npx redact-lint locked.pdf --password "$PDF_PASSWORD"
npx redact-lint report.pdf --sarif > redact.sarif
npx redact-lint *.pdf --annotations         # also list annotation/form text
```

Or install it in a project:

```bash
npm install -D redact-lint
```

| Option | Meaning |
| --- | --- |
| `--json` | One JSON object for all files, including `version` and `suppressed` |
| `--sarif` | SARIF 2.1.0 to stdout, for GitHub code scanning or another consumer |
| `--show-text` | Print covered text instead of masking it — local review only |
| `--min-coverage <0-1>` | How much of a text run a cover must span (default `0.6`) |
| `--annotations` | List annotation and form-field text as `notes`; never counted as leaks |
| `--password <pw>` | Password for an encrypted PDF |
| `--ignore-file <path>` | Waiver file (default `.redactlintignore` when present) |

| Exit | Meaning |
| --- | --- |
| `0` | No covered-but-extractable text found |
| `1` | At least one text run sits under a cover and is still in the file |
| `2` | Usage error, or a file could not be read or parsed |
| `3` | The PDF is encrypted and no usable password was given |

## Waivers

A false positive you cannot turn off is a reason to stop running the tool, so
suppressions exist — but every rule needs a reason, because an unexplained
waiver in a security check is how a real leak gets ignored for a year.

`.redactlintignore`, one rule per line:

```
public/archive/*.pdf        # scanned before 2019, document withdrawn
docs/report.pdf:3           # page 3 is a black divider, no text under it
```

Rules match the path passed on the command line (globs supported, `*` does not
cross `/`, `**` does). A bare integer after a colon limits a rule to one page.
A rule without a `#` reason is a hard error, not a silent pass. The report says
how many findings were waived and why, so a waiver stays visible in the log
instead of disappearing into a config file.

## GitHub Action

Fails a pull request when a changed PDF still hides text under a bar.

```yaml
permissions:
  contents: read
  pull-requests: read

jobs:
  redaction:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Kayforkind/redact-lint@v1
```

The action lists the PDFs the pull request added or modified — through the API,
so no `fetch-depth: 0` checkout is needed — scans them, writes a table to the
job summary, and exits non-zero when a leak is found. To actually block the
merge, require the check in **Settings → Branches → Require status checks**
(the job name, `redaction` above).

| Input | Default | Meaning |
| --- | --- | --- |
| `paths` | `**/*.pdf` | Comma-separated globs, used when not limited to the diff |
| `changed-only` | `true` | Only scan PDFs the pull request changed |
| `version` | `0.3.1` | redact-lint version to run |
| `min-coverage` | `0.6` | How much of a text run a cover must span |
| `show-text` | `false` | Print covered text instead of masking it |
| `fail-on` | `leak` | `never` reports without failing the job |
| `ignore-file` | `.redactlintignore` | Waiver file, relative to the repository root |

| Output | Meaning |
| --- | --- |
| `leaks` | Covered regions that still contain extractable text |
| `files` | PDFs inspected |
| `report` | Path to the JSON report |

For code scanning, upload the SARIF instead of (or as well as) failing the job:

```yaml
- uses: Kayforkind/redact-lint@v1
  continue-on-error: true
  with:
    changed-only: false
- run: npx --yes redact-lint@0.3.1 --sarif $(find public -name '*.pdf') > redact.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: redact.sarif
```

### pre-commit

`.pre-commit-hooks.yaml` is included, so a project that uses
[pre-commit](https://pre-commit.com) only needs:

```yaml
repos:
  - repo: https://github.com/Kayforkind/redact-lint
    rev: v0.3.1
    hooks:
      - id: redact-lint
```

The hook runs on staged PDFs and fails the commit on a leak.

## Scheduled sweep

`.github/workflows/sweep.yml` runs every Monday at 06:00 UTC over **every** PDF
in the repository, not just the ones a pull request touched — the documents
that were published before anyone started running this on PRs.

It keeps one issue in sync instead of filing a new one each week:

| Scan result | Issue |
| --- | --- |
| covered text still extractable | opened, or updated in place |
| clean | closed with a note |

Run it by hand from **Actions → Leak sweep**. Tick `demo` to generate a
painted-over fixture first, which exercises the whole path without needing a
real leak in the repo; leave it unticked to scan what is actually there.

## As a library

```js
import { analyzePdf, EncryptedPdfError } from 'redact-lint';

const result = await analyzePdf(bytes, { annotations: false });
// { pages, textRuns, summary: { leaks, hiddenRuns }, findings: [...], notes: [...] }
```

`findings[].kind` is `paint-over` (dark bar), `whiteout` (light bar),
`opaque-cover` (any other mid-tone cover) or `image-cover` (a bitmap painted
after the text). Types ship with the package (`src/analyze.d.mts`), and a
consumer sample is compiled by `npm run typecheck` in CI, so the declarations
cannot drift from the implementation without a red build.

```ts
import type { AnalyzeResult, Finding } from 'redact-lint';
```

`EncryptedPdfError` is thrown when a document needs a password and none was
passed, which is how the CLI distinguishes exit `3` from a parse error.

## How it decides

A rectangle proves nothing on its own: white page backgrounds and table
shading cover text too. What separates a background from a redaction is paint
order, and PDF content streams are ordered.

1. Walk the page operator list, tracking the graphics-state matrix, and record
   every opaque fill and image with its box and the operator position it was
   painted at.
2. Read text runs with their boxes and the position of the operator that
   painted them. Runs are matched to operators by their characters, not by
   counting operators: Word emits a separate operator for every space in a
   table cell and Chromium splits one line across several, which makes an
   ordinal comparison drift.
3. Report a cover only when it is painted **after** the text, covers at least
   60% of a run's box, and is smaller than 60% of the page (so full-page sheets
   and scans are never treated as covers).
4. Classify by luminance: dark bars are `paint-over`, light ones `whiteout`,
   everything else `opaque-cover`; bitmaps are `image-cover`.

That ordering rule is what keeps the tool quiet on real documents: a highlight,
a zebra-striped table row or a white page background is always painted *before*
its text. White-on-dark header bars are painted before their text as well, so
they are not reported either.

The full model, including the coverage maths and why images need the CTM, is
in [docs/algorithm.md](docs/algorithm.md).

## What it does not catch

Honest list, because a security tool that overstates itself is worse than none:

- **Already-flattened pages.** If a bad redaction was rasterized into the page
  image, nothing is extractable, so nothing is flagged — even though the pixels
  may still show the content.
- **Invisible text** that was never covered (text drawn in the background colour
  or clipped away) — a different bug, a different check.
- **Notes outside the page content stream.** `--annotations` *lists* annotation
  and form-field text, but it is reported as notes, never as a leak: whether
  that value leaks depends on the reader and the export.
- **Clipping, blend modes and transparency groups** are approximated: the tool
  assumes an opaque fill, and `opacity` is reported as `1`.
- **Fonts without a Unicode mapping** can produce empty text runs; those cannot
  be reported because there is nothing to compare.
- **Documents behind a password** are skipped with exit `3` unless
  `--password` is supplied.

A clean run means "no text found under a later-painted cover", not "this
document is safe". Pair it with a visual check of the exported page.

## Development

```bash
npm install
npm test                          # 54 tests: detector, fixtures, CLI, action, sweep, waivers, SARIF, real producers
npm run typecheck                 # declarations compile against a consumer sample
npm run bench                     # 25 documents, 8 exported by Chrome, Word and ReportLab
npm run bench:check               # same, failing when a floor is missed
npm run perf:check                # 200 pages must stay under 20 s
node scripts/make-fixtures.mjs    # writes leaky.pdf + clean.pdf to try it on
```

Most fixtures are generated with `pdf-lib` at test time (`test/fixtures.mjs`), so
every case is inspectable: a painted-over secret, the same leak on a rotated
page, a whiteout, a genuinely redacted file, a clean document, a highlight
panel, a bitmap cover, and a realistic three-page report with header bars and
zebra rows that must stay silent.

Eight more PDFs are committed under `bench/real/pdfs`, exported by Chrome,
Microsoft Word and ReportLab, with ground truth in `bench/real/manifest.json`.
They exist because generated fixtures only prove the detector works on pdf-lib
output; Word and Chromium each emit text and fills in their own order.
`node bench/real/make.mjs` regenerates them where the software is installed and
checks the result against the manifest.

The action is tested the same way — file selection, glob handling, outputs,
the job summary staying masked, and the exit code that blocks a merge — with
`RL_CLI` pointing at the local scanner so the suite needs no network.

CI runs the suite on Node 20, 22 and 24, plus macOS and Windows (the action and
the CLI both shell out, and macOS still ships bash 3.2), a packaging job that
installs the packed tarball, and a job that enforces the benchmark floors and
the performance budget.

## Releasing

```bash
npm version patch        # or minor / major — updates package.json
git push --follow-tags   # tag vX.Y.Z triggers .github/workflows/release.yml
```

The release workflow publishes over **npm trusted publishing**: it exchanges a
GitHub OIDC token for a short-lived credential, so there is no `NPM_TOKEN`
secret to leak or rotate, and the tarball gets a signed provenance statement.
It only needs a one-time trusted-publisher entry on npmjs.com (package
Settings → Trusted Publisher → GitHub Actions → `Kayforkind/redact-lint`,
workflow `release.yml`). After publishing it opens a GitHub Release from the
matching `CHANGELOG.md` section and advances the `v1` tag that the `uses:`
examples above pin, so the changelog, the release and the alias stay in step.

See [CHANGELOG.md](CHANGELOG.md) for what changed in each version and
[CONTRIBUTING.md](CONTRIBUTING.md) for how to send a change.

## License

MIT
