---
title: A black box is not a redaction
published: false
description: Documents keep shipping with "redacted" names that anyone can copy out from under the black rectangle. Here is why it happens, and how to fail your build instead.
tags: pdf, security, githubactions, opensource
---

Open almost any published PDF with a redacted section, drag across the black
bar, and paste somewhere. Sometimes you get a name.

That is not a hypothetical. It is the default outcome of the most common
redaction workflow there is, and it survives review because the page *looks*
right. The rectangle is there. The text is hidden. Nothing errors.

## The bug is a rectangle

A PDF page is a content stream: a sequence of instructions. Draw this text at
this position. Fill this rectangle with this colour. Redaction instructions
usually say the second half only — "cover it with a black box" — so that is
what tools do. The text instruction stays in the file.

On screen the result is indistinguishable from a real redaction. On disk it is
the opposite of one:

- selecting the area copies the covered text
- searching for the name finds it
- `pdftotext`, an accessibility tree, or any text extraction step returns it
- a document fed to a search index or a language model carries it along

The failure scales with how documents are used today. A PDF is not only
something a person reads on a screen; it is something machines parse, index and
summarise. A rectangle that only fools the first reader leaves the content
fully available to every other one.

The reason it keeps happening is that nothing in the workflow pushes back. The
preview renders correctly. The export succeeds. There is no warning, no diff,
no failing test. The only feedback arrives later, from someone else, usually in
public.

## What "actually redacted" means

Real redaction is destruction, not covering:

- the text-drawing instructions under the region are removed from the page
- hidden copies are cleared too — form field values, source annotations, the
  accessibility tree's `/Alt` and `/ActualText` entries
- metadata, embedded files and thumbnails are scrubbed if the document is
  sensitive
- when content cannot be proven removable (a scan, exotic fonts, a partially
  covered line), the page is rendered to pixels with the region burned in and
  the original content stream discarded

Those are different operations with different guarantees. One produces a
picture of a secret; the other produces a file the secret is no longer in.

## The check: when was the rectangle painted?

You cannot tell a background from a redaction by looking at a rectangle. White
page backgrounds and table shading cover text too — that is what they are for.

But PDF content streams are ordered, and that ordering is the tell:

```
background   fill, then text on top     -> the text is visible, not a leak
redaction    text, then fill on top     -> the text may still be extractable
```

[redact-lint](https://github.com/Kayforkind/redact-lint) walks the page's
operator list, tracks the graphics matrix, and records every opaque fill along
with the operator position where it was painted. It reads text runs with their
boxes and the position of the operator that drew them. A fill is reported only
when it is painted **after** the text, covers at least 60% of a run's box, and
is smaller than 60% of the page.

That last part matters: it is why a highlight, a zebra-striped table row or a
white-on-dark header bar does not produce a false alarm. All of them are
painted before their text. Only a cover that arrives after the content it hides
is suspicious.

```
$ npx redact-lint disclosure.pdf

LEAK  disclosure.pdf
  page 1  paint-over  #000000 190×22pt
    "SS•••••••••••••"  still extractable, 100% covered

1 page · 4 text runs · 1 leak
```

Covered text is masked by default, because this output ends up in build logs and
pasted into tickets. `--show-text` prints it for local review.

Exit codes are the interface: `0` clean, `1` a covered run is still in the
file, `2` the file could not be read. `--json` gives you the same findings as
data.

## Wiring it into CI

The check is most useful in the pull request that adds the document, not after
publication.

### GitHub Actions

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

The action asks the API which PDFs the pull request added or modified — no
`fetch-depth: 0` checkout — scans them, writes a table into the job summary, and
exits non-zero on a leak. Text stays masked in the summary.

**One extra step to actually block a merge:** Settings → Branches → Require
status checks, and pick the job. An action can fail; only branch protection can
refuse the merge.

Scanning everything instead of the diff:

```yaml
- uses: Kayforkind/redact-lint@v1
  with:
    changed-only: false
    paths: 'public/**/*.pdf'
```

### Any other CI

```bash
# GitLab, Buildkite, Jenkins, a Makefile
find public -name '*.pdf' -print0 | xargs -0 npx --yes redact-lint
```

`find` rather than `public/**/*.pdf`, because whether `**` recurses depends on
your shell's `globstar` setting — and a check that silently skips subdirectories
is worse than no check.

Non-zero exits fail the step. If you keep PDFs in a repository with a
`pre-commit` or `pre-push` hook, the same line works there.

### Documents that are already published

The PDFs that leaked last year were published before anyone ran a check on PRs.
A weekly sweep over everything catches those, and it should not file a new
ticket every week:

```yaml
on:
  schedule: [{ cron: '0 6 * * 1' }]
```

The repository's own [sweep workflow](https://github.com/Kayforkind/redact-lint/blob/main/.github/workflows/sweep.yml)
opens **one** issue when a scan finds covered text, updates that same issue
while it persists, and closes it on the first clean run.

## What it does not catch

A security tool that overstates itself is worse than none, so the limits are
part of the product:

- **Image covers.** A screenshot or a scanned page placed over text is not a
  fill. The tool does not infer what an image hides.
- **Invisible text** that was never covered — drawn in the background colour, or
  clipped away. That is a different bug with a different check.
- **Text in annotations, form fields, attachments or metadata.** Only the page
  content stream is inspected.
- **Encrypted PDFs.** They are not opened.
- **Flattened pages** where a bad redaction was rasterised into the page image:
  nothing is extractable, so nothing is flagged, even if the pixels still show
  the content.
- **Fonts without a Unicode mapping** can produce empty text runs, and there is
  nothing to compare.

A clean run means "no text found under a later-painted fill". It does not mean
"this document is safe". Pair it with a visual check of the exported page.

## If you only do one thing

Run it on the last three PDFs you published:

```bash
npx redact-lint *.pdf --show-text
```

If the command is quiet, you have three documents you can stop worrying about.
If it is not, you have found a leak in private rather than in public — which is
the entire point of a check that takes one second and uploads nothing.

- npm: [redact-lint](https://www.npmjs.com/package/redact-lint)
- source and action: [Kayforkind/redact-lint](https://github.com/Kayforkind/redact-lint)
