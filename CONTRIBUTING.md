# Contributing

Bug reports and pull requests are welcome. The most useful contribution is a
PDF that the scanner gets wrong, reduced to a case the suite can run.

## Setup

```bash
npm install
npm test                        # detector, CLI, action and sweep tests
npm run typecheck               # the published .d.mts types, compiled
npm run bench                   # accuracy table; rewrites BENCHMARK.md
node scripts/make-fixtures.mjs  # writes leaky.pdf and clean.pdf to try by hand
```

Node 20 or newer. There is no build step: the package ships the ESM sources.

## Reporting a bug

Include:

- `redact-lint --version`, your OS, and the exit code you got
- what the PDF viewer shows and what the scanner reported (or missed)
- the smallest document that still reproduces it, or better, a fixture

Anonymise before attaching: replace names with `test.pdf`-grade placeholders,
or rebuild the case with `pdf-lib`. Do not upload a real filing to a public
issue.

## Adding a fixture

Fixtures are generated at run time in `test/fixtures.mjs`, so every case is
readable code rather than an opaque binary:

1. add a function that builds the PDF and returns its bytes
2. add a test in `test/analyze.test.mjs` or `test/coverage.test.mjs` that
   asserts the finding — page, kind, cover colour — not just the count
3. for a document that must stay silent, assert `summary.leaks === 0` and say
   in a comment what could have made it fire

If a new fixture represents a real producer (Word, LibreOffice, LaTeX, Acrobat),
say which. Prefer committing the exported PDF to `bench/real/pdfs` with an
entry in `bench/real/manifest.json`, so CI scores the bytes rather than a
re-implementation of them; `bench/real/README.md` has the steps.

## Changing the detector

- Any change to the rules must move `npm run bench:check`, or the pull request
  must explain why the numbers stay put. "It still passes" is not enough when
  the change was supposed to catch something. The floors are 99% painted-cover
  recall, 99% image-cover recall and zero false-positive documents across the
  synthetic and real-producer corpora.
- Add the negative case as well as the positive one. Most of the detector's
  value is in staying quiet on zebra rows, header bars and page backgrounds.
- Keep the documented thresholds meaningful: a cover must be painted after the
  text, span at least `minCoverage` of the run (default 0.6), and be smaller
  than 60% of the page. Changing one means changing `README.md` and
  `docs/algorithm.md` in the same commit.
- A new leak class needs a kind name, a rule in `src/sarif.mjs`, an entry in
  `src/analyze.d.mts`, a fixture, and a line in the "What it does not catch"
  section it retires.

## Style

- Plain ESM, no build step, no transpiler.
- No new runtime dependency without a reason in the pull request. Each one is
  installed on every user's machine and in every CI job.
- Comments explain *why* a rule exists or why a check is skipped. The code says
  what.
- Errors are typed where the caller branches on them (`EncryptedPdfError`), and
  exit codes stay stable: `0` clean, `1` leaks, `2` usage or parse error, `3`
  encrypted without a password.
- Keep covered text masked unless `--show-text` was explicitly passed.

## Pull requests

- One concern per pull request. A detector fix and a README rewrite are two.
- Behaviour changes need a test that fails before the change.
- CI must be green on Linux, macOS and Windows, plus the accuracy floor and the
  performance budget. The macOS job exists because the action runs on bash 3.2.
- Add a `CHANGELOG.md` entry for a user-visible change: a new `## [Unreleased]`
  section at the top, or a line under the existing one.

## Proposing a new leak class

Open an issue with a document or fixture, the rule you would apply, and how many
false positives you expect on ordinary documents. The bar is high: a check that
fires on table shading trains people to ignore the tool. If it can be expressed
as "this thing was painted after the text and covers it", it belongs here; if it
needs to understand page semantics, it probably does not.
