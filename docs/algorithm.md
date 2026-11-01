# How the detector works

A PDF page is not a picture. It is a program, and `redact-lint` reads it as one.

This page describes the model the detector builds, the thresholds it applies and
the places where the model is wrong.

## A page is an operator list

The content stream of a page is a sequence of operators with operands, stored
uncompressed or in a stream filter:

```
q                       % save graphics state
1 0 0 1 72 640 cm       % transform: move to (72, 640)
1 0 0 rg                % fill colour: black? not yet, this is red
0 0 0 0 re              % rectangle path, zero-sized for illustration
f                       % fill it
BT /F1 12 Tf ... (Jane Doe) Tj ET   % draw text
Q
```

A conforming reader interprets those operators in order. Two properties matter
here:

- **Order is preserved.** Operators are executed top to bottom, so "text, then
  fill" and "fill, then text" are distinguishable facts about the file, not
  guesses about the appearance.
- **State is a stack.** `q` saves the current transformation matrix (CTM), fill
  colour, clipping path and the rest; `Q` restores them. Coordinates in the
  stream are in the CTM's space, so two rectangles with the same numbers can
  land in different places.

pdfjs-dist parses the stream once and exposes it as an operator list: parallel
arrays `fnArray` (operator codes, e.g. `OPS.fill`, `OPS.showText`) and
`argsArray` (their operands). `src/analyze.mjs` walks that list rather than the
rendered page, which is why it needs no canvas and no GPU.

### The coordinate system

`page.getViewport({ scale: 1 })` provides `viewport.transform`, mapping PDF user
space to device space with the page's rotation applied. Both covers and text
boxes are computed in device space, so a fill and the text it covers land in the
same coordinates regardless of page rotation.

## Why paint order is the discriminator

Every page with a background has shapes under its text. A white page rectangle,
a zebra-striped table row, a coloured heading bar — all are fills, all overlap
text, none of them are leaks. In each case the fill was painted *first*.

A redaction box is the opposite: the text was painted, then the box was drawn
over it. That single relationship — later paint over earlier text — is what
separates a background from a cover, and it is a property of the instruction
order rather than of how the page looks. The two states render identically; only
the file distinguishes them.

## Building the two sides

### Text runs

`page.getTextContent()` returns items with `str`, `transform`, `width`,
`height`, and no operator position. To recover painting order, `textRuns()`
first collects the indexes of every text-showing operator (`OPS.showText`,
`OPS.showSpacedText`) in the operator list, then pairs them with the content
items in order. Each run records its `opIndex`.

The box comes from `textBox()`. It transforms the item's text matrix by the
viewport and then builds a quadrilateral from the matrix's own axes:

- the advance direction (`m[0] / ax`, `m[1] / ax`) times `item.width`, giving the
  horizontal extent;
- the ascent direction (`m[2] / ay`, `m[3] / ay`) times `item.height`, from
  `-0.25` (descender) to `0.85` (ascender) of the font size.

The result is an axis-aligned box around the glyphs. Building it from the
matrix axes rather than from the raw width and height is what keeps rotated and
skewed pages correct: on a 90° page a naive box would sit somewhere the text
does not.

### Covers

`covers()` walks the same operator list while tracking state:

| Operator | Effect on the walk |
| --- | --- |
| `OPS.save` | push the CTM onto a stack |
| `OPS.restore` | pop the CTM |
| `OPS.transform` | `ctm = ctm × operands` |
| `OPS.setFillRGBColor` | record the current fill colour |
| `OPS.constructPath` | map the path's bounding box through `viewport.transform × ctm` |
| `OPS.fill`, `OPS.eoFill` | emit the recorded path bbox as a cover |
| `OPS.fillStroke`, `OPS.eoFillStroke`, `OPS.closeFillStroke` | same, because they fill too |
| `OPS.paintImageXObject`, `OPS.paintImageMaskXObject`, `OPS.paintInlineImageXObject` | emit the unit square transformed by the CTM |

Each cover records its box, its fill colour (or `null` for an image), its
luminance and the `opIndex` at which it was painted.

An image is emitted as the transformed unit square because that is how images
work in PDF: an image XObject is painted into the unit square and scaled by the
CTM. The bitmap's pixel width and height say nothing about where it lands on the
page, so the CTM is the only usable source for the footprint.

## Deciding whether a cover covers

With both sides in hand, for every cover and every run on the page:

1. **Order.** If `cover.opIndex < run.opIndex`, the cover was painted before the
   text and is a background. Skip it. A run with no known operator position is
   not skipped by order and must survive the coverage test on its own.
2. **Page area.** If the cover's area is more than `maxFillArea` (default `0.6`)
   of the page, skip it. That is a sheet, not a redaction.
3. **Coverage.** Compute the intersection area of the cover and the run's box,
   divide by the run's area, and keep the run when the ratio is at least
   `minCoverage` (default `0.6`). Partial coverage below the threshold is
   deliberately not reported: a bar clipping the edge of a line is ordinary
   layout.

The coverage ratio is returned per run (`coverage`, rounded to two decimals) so
a reviewer can see how convincing the cover was.

### Classifying the cover

Luminance is the Rec. 709 weighted sum: `0.2126 r + 0.7152 g + 0.0722 b`, with
components normalised to 0–1.

| `kind` | Condition | Typical cause |
| --- | --- | --- |
| `paint-over` | luminance ≤ `darkLuma` (0.3) | black rectangle |
| `whiteout` | luminance ≥ `lightLuma` (0.85) | white or near-white rectangle |
| `opaque-cover` | anything between | coloured rectangle |
| `image-cover` | cover is an image | screenshot or scan pasted over text |

The thresholds are options on `analyzePdf` (`darkLuma`, `lightLuma`,
`minCoverage`, `maxFillArea`), which is also how the tests pin behaviour at the
boundaries.

## What the output contains

`analyzePdf` returns `{ pages, textRuns, summary, findings, notes }`:

- `summary.leaks` is the number of findings, one per cover that hides at least
  one run;
- `summary.hiddenRuns` counts the individual runs;
- each finding carries `page`, `kind`, the cover geometry in `fill` (with
  `color`, `luminance`, `opacity`) and the covered runs.

Text is masked by `maskText()` — first two characters, then bullets — unless
`showText` is set. Lint output ends up in CI logs and pasted into tickets, so
the default has to be safe to share.

`--annotations` adds a separate `notes` array built from form-field values
(`doc.getFieldObjects()`) and annotation contents (`page.getAnnotations()`).
Duplicates are dropped by kind and masked text. A form value is not a leak; it
is text that may have survived a redaction elsewhere, which is why it is
reported and counted separately.

## Why it reports and does not redact

Removing text from a PDF is not an edit, it is a rewrite. The glyphs may come
from a subset font with no Unicode mapping, the text may be shared with other
runs through a form XObject, and the surrounding layout is positioned
absolutely. A tool that "fixes" a finding would have to re-lay-out the page, and
it cannot know whether the author wanted the covered area blacked out, the
sentence removed, or the whole page dropped.

The check is therefore the whole product: it says what is still extractable and
leaves the decision — and the responsibility — with the person who publishes the
document.

## What this model gets wrong

- **Clipping and blend modes.** `opacity` is always reported as `1`. A cover
  drawn with transparency, inside a clipped region, or through a blend mode is
  approximated as an opaque rectangle.
- **Flattened pages.** If a bad redaction was rasterised into the page image,
  nothing is extractable and nothing is reported, even though the pixels may
  still show the content.
- **Fonts without a Unicode mapping.** Such runs yield empty or garbage text
  and can be missed. The check has nothing to compare.
- **Run-to-operator pairing.** Order is recovered by counting text-showing
  operators and pairing them positionally with content items. Unusual content
  streams — text inside form XObjects, marked-content sections that pdfjs
  groups differently — can misalign the two lists.
- **Bounding boxes, not glyph outlines.** Coverage is box overlap. A box that
  is mostly whitespace is easier to "cover" than a dense line, and a cover
  rotated relative to the text is measured by its axis-aligned box.
- **Page-sized covers.** Anything above `maxFillArea` is skipped by design, so a
  genuine full-page redaction is not reported.
