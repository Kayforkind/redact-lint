/**
 * The benchmark corpus.
 *
 * Every document is generated at run time, so the numbers are reproducible and
 * the repository carries no binaries. The corpus deliberately spans several
 * producers — pdf-lib, PDFKit, and hand-built content streams — because a
 * detector tuned to one producer's operator choices is a detector that works
 * on its own fixtures.
 *
 * This is NOT a scrape of real published documents. It is a stand-in that
 * covers the shapes those documents take; the gaps are listed in BENCHMARK.md.
 */
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import PDFKit from 'pdfkit';

export const SECRET = 'SSN 123-45-6789';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFUlEQVR42mNkYPhfz0BkYBxVSF+FAAsyE/1s1s2zAAAAAElFTkSuQmCC',
  'base64',
);

async function blankPage(opts = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(opts.size || [612, 792]);
  if (opts.background !== false) {
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(1, 1, 1) });
  }
  page.drawText('Quarterly disclosure', { x: 72, y: 730, size: 13, font, color: rgb(0.1, 0.1, 0.1) });
  page.drawText('Applicant: Jane Q. Public', { x: 72, y: 700, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(SECRET, { x: 72, y: 670, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
  page.drawText('Filed 2026-10-31', { x: 72, y: 640, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
  return { doc, page, font };
}

function boxes(doc, page, spec) {
  for (const box of spec) {
    page.drawRectangle({
      x: box.x, y: box.y, width: box.w, height: box.h,
      color: box.white ? rgb(1, 1, 1) : box.gray ? rgb(0.8, 0.8, 0.8) : rgb(0, 0, 0),
    });
  }
  return doc.save();
}

async function painted(variant = {}) {
  const { doc, page } = await blankPage();
  if (variant.rotate) {
    page.setRotation?.(degrees(variant.rotate));
  }
  const box = variant.box || { x: 68, y: 665, w: 190, h: 22 };
  const bytes = await boxes(doc, page, [box]);
  if (!variant.rotate) return bytes;
  const rotated = await PDFDocument.load(bytes);
  rotated.getPage(0).setRotation(degrees(variant.rotate));
  return rotated.save();
}

async function twoColumns() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  for (let row = 0; row < 12; row++) {
    const y = 700 - row * 22;
    page.drawText(`Left column line ${row}`, { x: 60, y, size: 10, font, color: rgb(0, 0, 0) });
    page.drawText(`Right column line ${row}`, { x: 330, y, size: 10, font, color: rgb(0, 0, 0) });
  }
  page.drawText(SECRET, { x: 330, y: 600, size: 10, font, color: rgb(0, 0, 0) });
  page.drawRectangle({ x: 326, y: 596, width: 150, height: 18, color: rgb(0, 0, 0) });
  return doc.save();
}

async function cleanReport() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 2; p++) {
    const page = doc.addPage([612, 792]);
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 0, y: 740, width: 612, height: 52, color: rgb(0.1, 0.12, 0.2) });
    page.drawText(`Annual report ${p + 1}`, { x: 72, y: 758, size: 16, font, color: rgb(1, 1, 1) });
    for (let row = 0; row < 15; row++) {
      const y = 660 - row * 30;
      if (row % 2) page.drawRectangle({ x: 60, y: y - 8, width: 492, height: 26, color: rgb(0.93, 0.94, 0.96) });
      page.drawText(`Line item ${row + 1}`, { x: 72, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
      page.drawText(`${(row + 1) * 1234}`, { x: 420, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    }
    page.drawText('Confidential — internal use only', { x: 120, y: 260, size: 40, font, color: rgb(0.88, 0.88, 0.88) });
  }
  return doc.save();
}

async function imageCoverDoc() {
  const { doc, page } = await blankPage();
  const image = await doc.embedPng(PNG);
  page.drawImage(image, { x: 68, y: 663, width: 200, height: 24 });
  return doc.save();
}

/** A page-sized scan with text underneath: normal, not a cover. */
async function scannedPage() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const image = await doc.embedPng(PNG);
  page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(SECRET, { x: 72, y: 670, size: 11, font, color: rgb(0, 0, 0) });
  return doc.save();
}

async function formDoc() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Applicant record', { x: 72, y: 720, size: 14, font, color: rgb(0, 0, 0) });
  const form = doc.getForm();
  const field = form.createTextField('applicant');
  field.addToPage(page, { x: 72, y: 660, width: 240, height: 20 });
  field.setText('Jane Q. Public');
  return doc.save();
}

function pdfkitDoc(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFKit({ size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}

const pdfkitPainted = () =>
  pdfkitDoc((doc) => {
    doc.fontSize(12).text('Name: Jane Q. Public', 72, 80);
    doc.fontSize(12).text(SECRET, 72, 110);
    doc.rect(70, 104, 200, 22).fill('#000000');
  });

const pdfkitClean = () =>
  pdfkitDoc((doc) => {
    doc.fontSize(16).text('Invoice', 72, 60);
    doc.rect(0, 0, 595, 40).fill('#1c2033');
    doc.fill('#ffffff').fontSize(12).text('NavigatorsLab', 72, 15);
    doc.fill('#000000').fontSize(11).text('Total due: 14,500', 72, 120);
    for (let row = 0; row < 8; row++) {
      const y = 160 + row * 26;
      if (row % 2) doc.rect(60, y - 5, 470, 20).fill('#f2f4f8');
      doc.fill('#000000').fontSize(10).text(`Item ${row + 1}`, 72, y);
    }
  });

async function encryptedDoc(password = 'secret') {
  return pdfkitDocWithOptions({ userPassword: password, ownerPassword: 'owner' }, (doc) => {
    doc.fontSize(12).text(SECRET, 72, 110);
    doc.rect(70, 104, 200, 22).fill('#000000');
  });
}

function pdfkitDocWithOptions(options, draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFKit({ size: 'A4', ...options });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}

/** Hand-built content stream: text drawn, then a cover, as a minimal producer. */
async function handBuilt() {
  const text = 'BT /F1 12 Tf 72 700 Td (SSN 123-45-6789) Tj ET';
  const cover = '0 0 0 rg 68 694 190 22 re f';
  const stream = `${text}\n${cover}\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

export async function buildCorpus() {
  const docs = [];
  const add = (entry) => docs.push(entry);

  // Painted covers, the core case: six variants of geometry and colour.
  add({ name: 'paint-default', class: 'painted', producer: 'pdf-lib', expectedLeaks: 1, bytes: await painted() });
  add({
    name: 'paint-tight-box',
    class: 'painted',
    producer: 'pdf-lib',
    expectedLeaks: 1,
    bytes: await painted({ box: { x: 70, y: 666, w: 150, h: 18 } }),
  });
  add({
    name: 'paint-whiteout',
    class: 'painted',
    producer: 'pdf-lib',
    expectedLeaks: 1,
    bytes: await painted({ box: { x: 68, y: 665, w: 190, h: 22, white: true } }),
  });
  add({
    name: 'paint-gray',
    class: 'painted',
    producer: 'pdf-lib',
    expectedLeaks: 1,
    bytes: await painted({ box: { x: 68, y: 665, w: 190, h: 22, gray: true } }),
  });
  add({
    name: 'paint-rotated',
    class: 'painted',
    producer: 'pdf-lib',
    expectedLeaks: 1,
    bytes: await painted({ rotate: 90 }),
  });
  add({ name: 'paint-two-column', class: 'painted', producer: 'pdf-lib', expectedLeaks: 1, bytes: await twoColumns() });
  add({ name: 'paint-pdfkit', class: 'painted', producer: 'pdfkit', expectedLeaks: 1, bytes: await pdfkitPainted() });
  add({ name: 'paint-hand-built', class: 'painted', producer: 'raw', expectedLeaks: 1, bytes: await handBuilt() });

  // Covers that are not text: an image pasted on top.
  add({ name: 'image-cover', class: 'image', producer: 'pdf-lib', expectedLeaks: 1, bytes: await imageCoverDoc() });

  // Documents that must stay quiet.
  add({ name: 'clean-report-2p', class: 'clean', producer: 'pdf-lib', expectedLeaks: 0, bytes: await cleanReport() });
  add({ name: 'clean-pdfkit-invoice', class: 'clean', producer: 'pdfkit', expectedLeaks: 0, bytes: await pdfkitClean() });
  add({ name: 'clean-scan-with-ocr', class: 'clean', producer: 'pdf-lib', expectedLeaks: 0, bytes: await scannedPage() });
  add({ name: 'clean-form', class: 'clean', producer: 'pdf-lib', expectedLeaks: 0, notes: 1, bytes: await formDoc() });
  add({ name: 'clean-blank-page', class: 'clean', producer: 'pdf-lib', expectedLeaks: 0, bytes: await (async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    return doc.save();
  })() });

  // Deliberate edge cases where the documented thresholds decide the answer.
  add({
    name: 'edge-partial-cover',
    class: 'edge',
    producer: 'pdf-lib',
    expectedLeaks: 0, // about a third of the run: below the documented 60% threshold
    note: 'partial coverage falls under the threshold by design',
    bytes: await (async () => {
      const { doc, page } = await blankPage();
      return boxes(doc, page, [{ x: 68, y: 665, w: 30, h: 22 }]);
    })(),
  });
  add({
    name: 'edge-boxes-no-text',
    class: 'edge',
    producer: 'pdf-lib',
    expectedLeaks: 0,
    note: 'black bars over empty space',
    bytes: await (async () => {
      const { doc, page } = await blankPage();
      return boxes(doc, page, [{ x: 300, y: 300, w: 120, h: 18 }]);
    })(),
  });

  // Encrypted: an error path, reported separately from the scores.
  add({ name: 'encrypted-locked', class: 'encrypted', producer: 'pdfkit', expectedError: true, bytes: await encryptedDoc() });

  return docs;
}
