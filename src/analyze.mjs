/**
 * redact-lint — detect redaction that only paints over text.
 *
 * The failure this catches is old, common and embarrassing: a document is
 * "redacted" by drawing a black (or white) rectangle on top of a name or an ID
 * number. The page looks clean, the text is still in the file, and anyone can
 * select it, copy it, or extract it with a two-line script. Courts, councils
 * and companies have all shipped leaks this way.
 *
 * A rectangle alone proves nothing. What matters is *when* it was painted:
 *
 *   background  fill, then text on top        -> text is visible, not a leak
 *   redaction   text, then fill on top        -> text may still be extractable
 *
 * PDF content streams are ordered, so the operator list gives us exactly that
 * relationship. A cover is reported only when it is painted after the text it
 * covers, covers that text almost entirely, and is not a page-sized sheet.
 *
 * Two further cover shapes matter in practice: an image placed over text (a
 * screenshot of the page is a common "redaction") and a document that cannot
 * be read at all without a password. Annotation and form-field text is
 * collectable but reported separately, because a form value is not a leak on
 * its own — it is text the author may not have meant to ship.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument, OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(import.meta.url);
const PDFJS_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'));
const STANDARD_FONTS = path.join(PDFJS_ROOT, 'standard_fonts') + path.sep;

const DEFAULTS = {
  /** Fraction of a text run's box a fill must cover to count. */
  minCoverage: 0.6,
  /** Fills larger than this fraction of the page are treated as backgrounds. */
  maxFillArea: 0.6,
  /** Luminance at or below this reads as a deliberate black bar. */
  darkLuma: 0.3,
  /** Luminance at or above this reads as a whiteout. */
  lightLuma: 0.85,
};

const FILL_OPS = new Set([OPS.fill, OPS.eoFill]);
const CLOSING_FILL_OPS = new Set([OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke]);
const TEXT_OPS = new Set([OPS.showText, OPS.showSpacedText]);
const IMAGE_OPS = new Set([
  OPS.paintImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintInlineImageXObject,
]);

/** Thrown when the document needs a password. The CLI maps this to exit 3. */
export class EncryptedPdfError extends Error {
  constructor(message = 'PDF is encrypted and no usable password was given') {
    super(message);
    this.name = 'EncryptedPdfError';
  }
}

function multiply(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMatrix(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Path bbox [x0,y0,x1,y1] in path space -> axis-aligned device rect. */
function toDeviceRect(m, bbox) {
  const [x0, y0, x1, y1] = bbox;
  const pts = [
    applyMatrix(m, x0, y0),
    applyMatrix(m, x1, y0),
    applyMatrix(m, x0, y1),
    applyMatrix(m, x1, y1),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.abs(Math.max(...xs) - Math.min(...xs)),
    h: Math.abs(Math.max(...ys) - Math.min(...ys)),
  };
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hex(rgb) {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function classify(fillLuma, opts) {
  if (fillLuma <= opts.darkLuma) return 'paint-over';
  if (fillLuma >= opts.lightLuma) return 'whiteout';
  return 'opaque-cover';
}

function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

/** Text runs on one page, with the operator-list position each was painted at. */
function textRuns(content, viewport, ops, fnArray) {
  const showAt = [];
  for (let i = 0; i < fnArray.length; i++) {
    if (TEXT_OPS.has(fnArray[i])) showAt.push(i);
  }
  const runs = [];
  for (const item of content.items) {
    if (!item.str || !item.str.trim()) continue;
    runs.push({
      text: item.str,
      box: textBox(viewport, item),
      opIndex: showAt[runs.length],
    });
  }
  return runs;
}

/**
 * Glyph box in device space, built from the text matrix's own axes so rotated
 * and skewed pages map the same way fills do. Getting this wrong on a 90°
 * page makes every run look like it is somewhere other than the text is.
 */
function textBox(viewport, item) {
  const m = Util.transform(viewport.transform, item.transform);
  const size = item.height || 1;
  const ax = Math.hypot(m[0], m[1]) || 1;
  const ay = Math.hypot(m[2], m[3]) || 1;
  const advance = [m[0] / ax, m[1] / ax]; // direction text runs in
  const ascent = [m[2] / ay, m[3] / ay]; // direction glyphs rise in
  // Baseline-relative glyph extent: descender to ascender.
  const corners = [[0, -0.25], [1, -0.25], [0, 0.85], [1, 0.85]].map(([along, up]) => [
    m[4] + advance[0] * along * item.width + ascent[0] * up * size,
    m[5] + advance[1] * along * item.width + ascent[1] * up * size,
  ]);
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * Opaque covers on one page, in painting order, with the operator position.
 *
 * `type` is 'fill' for a painted shape and 'image' for a bitmap or stencil
 * mask. Images are painted into the unit square under the current matrix, so
 * their footprint is that square transformed — the bitmap's pixel dimensions
 * are irrelevant to where it lands on the page.
 */
function covers(fnArray, argsArray, viewport) {
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let color = [0, 0, 0];
  let pathBBox = null;
  let pathOp = -1;

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    switch (fn) {
      case OPS.save:
        stack.push(ctm);
        break;
      case OPS.restore:
        if (stack.length) ctm = stack.pop();
        break;
      case OPS.transform:
        ctm = multiply(ctm, args);
        break;
      case OPS.setFillRGBColor:
        color = [args[0] ?? 0, args[1] ?? 0, args[2] ?? 0];
        break;
      case OPS.constructPath: {
        // args: [pathOps, pathCoords, pathBBox] — the bbox is in path space.
        const bbox = Array.isArray(args[2]) ? args[2] : null;
        pathBBox = bbox && bbox.length === 4 ? toDeviceRect(multiply(viewport.transform, ctm), bbox) : null;
        pathOp = i;
        break;
      }
      default:
        if (FILL_OPS.has(fn) || CLOSING_FILL_OPS.has(fn)) {
          if (pathBBox) {
            const luma = luminance(color);
            out.push({ ...pathBBox, rgb: color, luma, opIndex: pathOp, type: 'fill' });
          }
          pathBBox = null;
        } else if (IMAGE_OPS.has(fn)) {
          const rect = toDeviceRect(multiply(viewport.transform, ctm), [0, 0, 1, 1]);
          out.push({ ...rect, rgb: null, luma: null, opIndex: i, type: 'image' });
        }
    }
  }
  return out;
}

/** Masked by default: lint output lands in CI logs and pastes into issues. */
export function maskText(text) {
  const visible = text.trim().slice(0, 2);
  return visible + '•'.repeat(Math.max(1, text.trim().length - visible.length));
}

/**
 * Analyse one PDF.
 *
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {{minCoverage?: number, maxFillArea?: number, darkLuma?: number, lightLuma?: number, showText?: boolean, annotations?: boolean, password?: string}} [options]
 * @throws {EncryptedPdfError} when the document needs a password that was not given
 */
export async function analyzePdf(bytes, options = {}) {
  // undefined must not erase a default: `coverage < undefined` is always false,
  // which would make every fill "cover" every text run on the page.
  const opts = { ...DEFAULTS };
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) opts[key] = value;
  }
  // pdfjs rejects Node Buffers by identity check, so hand it a plain view.
  const data = toBytes(bytes);
  let doc;
  try {
    doc = await getDocument({
      data,
      password: opts.password,
      standardFontDataUrl: STANDARD_FONTS,
      useSystemFonts: false,
      isEvalSupported: false,
    }).promise;
  } catch (err) {
    if (err?.name === 'PasswordException') throw new EncryptedPdfError();
    throw err;
  }

  const findings = [];
  const pages = doc.numPages;
  let textRunCount = 0;

  for (let pageNo = 1; pageNo <= pages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1 });
    const [content, operatorList] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
    const runs = textRuns(content, viewport, operatorList, operatorList.fnArray);
    const painted = covers(operatorList.fnArray, operatorList.argsArray, viewport);
    textRunCount += runs.length;

    const pageArea = viewport.width * viewport.height;
    for (const cover of painted) {
      const area = cover.w * cover.h;
      if (area <= 0 || area / pageArea > opts.maxFillArea) continue;

      const kind = cover.type === 'image' ? 'image-cover' : classify(cover.luma, opts);
      const covered = [];
      for (const run of runs) {
        if (run.opIndex != null && cover.opIndex < run.opIndex) continue; // painted under the text
        const runArea = run.box.w * run.box.h;
        if (runArea <= 0) continue;
        const coverage = overlapArea(cover, run.box) / runArea;
        if (coverage < opts.minCoverage) continue;
        covered.push({
          text: opts.showText ? run.text : maskText(run.text),
          coverage: Math.round(coverage * 100) / 100,
          box: round(run.box),
        });
      }
      if (!covered.length) continue;

      findings.push({
        page: pageNo,
        kind,
        fill: {
          ...round(cover),
          type: cover.type,
          color: cover.rgb ? hex(cover.rgb) : null,
          luminance: cover.luma == null ? null : Math.round(cover.luma * 100) / 100,
          opacity: 1,
        },
        covered,
      });
    }
  }

  const notes = opts.annotations ? await collectNotes(doc, pages, opts) : [];
  await doc.destroy();
  return {
    pages,
    textRuns: textRunCount,
    summary: {
      leaks: findings.length,
      hiddenRuns: findings.reduce((n, f) => n + f.covered.length, 0),
      notes: notes.length,
    },
    findings,
    notes,
  };
}

/**
 * Text carried by annotations and form fields. Opt-in: a filled-in form field
 * is not a leak by itself, but it is exactly where a "redacted" value survives
 * after the visible copy was removed.
 */
async function collectNotes(doc, pages, opts) {
  const notes = [];
  const seen = new Set();
  const add = (note) => {
    const key = `${note.kind}:${note.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    notes.push(note);
  };
  const mask = (text) => (opts.showText ? text : maskText(text));

  let fields = null;
  try {
    fields = await doc.getFieldObjects();
  } catch {
    fields = null;
  }
  for (const [name, list] of Object.entries(fields || {})) {
    for (const field of list || []) {
      const value = typeof field?.value === 'string' ? field.value.trim() : '';
      if (!value) continue;
      add({ page: null, kind: 'form-field', label: name, text: mask(value) });
    }
  }

  for (let pageNo = 1; pageNo <= pages; pageNo++) {
    const page = await doc.getPage(pageNo);
    let annotations = [];
    try {
      annotations = await page.getAnnotations({ intent: 'display' });
    } catch {
      annotations = [];
    }
    for (const ann of annotations) {
      const text = String(ann?.contentsObj?.str || ann?.fieldValue || '').trim();
      if (!text) continue;
      add({
        page: pageNo,
        kind: ann?.subtype ? String(ann.subtype).toLowerCase() : 'annotation',
        label: String(ann?.titleObj?.str || ann?.id || ''),
        text: mask(text),
      });
    }
  }
  return notes;
}

function toBytes(input) {
  if (input instanceof Uint8Array && input.constructor === Uint8Array) return input;
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError('analyzePdf expects a Uint8Array, Buffer or ArrayBuffer');
}

function round(box) {
  return Object.fromEntries(Object.entries(box).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 10) / 10 : v]));
}
