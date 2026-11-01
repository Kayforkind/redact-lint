# redact-lint

[![CI](https://github.com/Kayforkind/redact-lint/actions/workflows/ci.yml/badge.svg)](https://github.com/Kayforkind/redact-lint/actions/workflows/ci.yml)

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

## Usage

```bash
npx redact-lint report.pdf                 # human output, exits 1 on leaks
npx redact-lint *.pdf --json               # machine-readable, for CI
npx redact-lint report.pdf --show-text     # print the covered text (local only)
npx redact-lint report.pdf --min-coverage 0.5
```

Or install it in a project:

```bash
npm install -D redact-lint
```

| Exit | Meaning |
| --- | --- |
| `0` | No covered-but-extractable text found |
| `1` | At least one text run sits under an opaque fill and is still in the file |
| `2` | Usage error, or a file could not be read or parsed |

### In CI

```yaml
- name: No fake redactions
  run: npx --yes redact-lint public/*.pdf
```

Run it in the pull request that adds the document, not after publication.

### As a library

```js
import { analyzePdf } from 'redact-lint';

const result = await analyzePdf(bytes);
// { pages, textRuns, summary: { leaks, hiddenRuns }, findings: [...] }
```

`findings[].kind` is `paint-over` (dark bar), `whiteout` (light bar) or
`opaque-cover` (any other mid-tone cover).

## How it decides

A rectangle proves nothing on its own: white page backgrounds and table
shading cover text too. What separates a background from a redaction is paint
order, and PDF content streams are ordered.

1. Walk the page operator list, tracking the graphics-state matrix, and record
   every opaque fill with its rectangle and the operator position it was
   painted at.
2. Read text runs with their boxes and the position of the operator that
   painted them.
3. Report a fill only when it is painted **after** the text, covers at least
   60% of a run's box, and is smaller than 60% of the page (so full-page sheets
   are never treated as covers).
4. Classify by fill luminance: dark bars are `paint-over`, light ones
   `whiteout`, everything else `opaque-cover`.

That ordering rule is what keeps the tool quiet on real documents: a highlight,
a zebra-striped table row or a white page background is always painted *before*
its text. White-on-dark header bars are painted before their text as well, so
they are not reported either.

## What it does not catch

Honest list, because a security tool that overstates itself is worse than none:

- **Image covers.** A screenshot or scanned page placed over text is not a
  fill; this tool does not infer what an image hides.
- **Invisible text** that was never covered (text drawn in the background color
  or clipped away) — different bug, different check.
- **Text in annotations, form fields, attachments or document metadata.** The
  body content stream is what is inspected.
- **Encrypted PDFs**, and PDFs that need a password, are not opened.
- **Clipping, blend modes and transparency groups** are approximated: the tool
  assumes an opaque fill, and `opacity` is reported as `1`.
- **Already-flattened pages** where a bad redaction was rasterized into the
  page image: nothing is extractable, so nothing is flagged, even though the
  pixels may still show the content.
- **Fonts without a Unicode mapping** can produce empty text runs; those cannot
  be reported because there is nothing to compare.

A clean run means "no text found under a later-painted fill", not "this
document is safe". Pair it with a visual check of the exported page.

## Development

```bash
npm install
npm test                          # 14 tests: detector, fixtures, CLI contract
node scripts/make-fixtures.mjs    # writes leaky.pdf + clean.pdf to try it on
```

Fixtures are generated with `pdf-lib` at test time (`test/fixtures.mjs`), so
every case is inspectable: a painted-over secret, the same leak on a rotated
page, a whiteout, a genuinely redacted file, a clean document, a highlight
panel, and a realistic three-page report with header bars and zebra rows that
must stay silent.

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
workflow `release.yml`).

## License

MIT
