/**
 * Generates the fixture PDFs the tests run against.
 *
 * Each fixture mimics a real redaction workflow at the file-structure level:
 * the difference between "redacted" and "painted over" is only whether the
 * text bytes are still in the page content stream under the black box.
 */
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import PDFKit from 'pdfkit';

const SECRET = 'SSN 123-45-6789';

async function basePage(opts = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);

  if (opts.background) {
    page.drawRectangle({
      x: 0, y: 0, width: 612, height: 792,
      color: rgb(1, 1, 1),
    });
  }

  page.drawText('ACME Corp - Employee Record', { x: 72, y: 720, size: 14, font, color: rgb(0, 0, 0) });
  page.drawText('Name: Jane Q. Public', { x: 72, y: 690, size: 12, font, color: rgb(0, 0, 0) });
  page.drawText(SECRET, { x: 72, y: 660, size: 12, font, color: rgb(0, 0, 0) });
  page.drawText('Filed 2026-10-31', { x: 72, y: 630, size: 12, font, color: rgb(0, 0, 0) });
  return { doc, page, font };
}

/** Text physically present, black box painted on top afterwards: a leak. */
export async function paintedOver() {
  const { doc, page } = await basePage({ background: true });
  page.drawRectangle({ x: 68, y: 655, width: 190, height: 22, color: rgb(0, 0, 0) });
  return doc.save();
}

/** White box over text - the "whiteout" that leaks the same way. */
export async function whiteout() {
  const { doc, page } = await basePage();
  page.drawRectangle({ x: 68, y: 655, width: 190, height: 22, color: rgb(1, 1, 1) });
  return doc.save();
}

/** Text genuinely rebuilt without the secret: nothing under the box. */
export async function trulyRedacted() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(1, 1, 1) });
  page.drawText('ACME Corp - Employee Record', { x: 72, y: 720, size: 14, font, color: rgb(0, 0, 0) });
  page.drawText('Name: Jane Q. Public', { x: 72, y: 690, size: 12, font, color: rgb(0, 0, 0) });
  // The secret is gone from the content stream; the label lives elsewhere and
  // the bar sits over empty space.
  page.drawText('SSN: [REDACTED]', { x: 72, y: 600, size: 12, font, color: rgb(0, 0, 0) });
  page.drawText('Filed 2026-10-31', { x: 72, y: 630, size: 12, font, color: rgb(0, 0, 0) });
  page.drawRectangle({ x: 68, y: 655, width: 190, height: 22, color: rgb(0, 0, 0) });
  return doc.save();
}

/** Same leak on a rotated page (landscape scan inside a portrait page). */
export async function paintedOverRotated() {
  const bytes = await paintedOver();
  const doc = await PDFDocument.load(bytes);
  doc.getPage(0).setRotation(degrees(90));
  return doc.save();
}

// A 16×16 opaque PNG, used for the image-cover cases.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFUlEQVR42mNkYPhfz0BkYBxVSF+FAAsyE/1s1s2zAAAAAElFTkSuQmCC',
  'base64',
);

/** A bitmap pasted over live text: looks redacted, is not. */
export async function imageCover() {
  const { doc, page } = await basePage();
  const image = await doc.embedPng(PNG);
  page.drawImage(image, { x: 68, y: 653, width: 220, height: 22 });
  return doc.save();
}

/** A logo drawn before the text it sits behind: must NOT be reported. */
export async function imageBehindText() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const image = await doc.embedPng(PNG);
  page.drawImage(image, { x: 68, y: 653, width: 220, height: 22 });
  page.drawText(SECRET, { x: 72, y: 660, size: 12, font, color: rgb(1, 1, 1) });
  return doc.save();
}

/** A form field whose value is still in the file, independently of the page. */
export async function formWithValue() {
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

/** A different producer (PDFKit), with the same painted-over text. */
export async function pdfkitLeak() {
  const doc = new PDFKit({ size: 'A4' });
  const chunks = [];
  await new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', resolve);
    doc.on('error', reject);
    doc.fontSize(12).text('Name: Jane Q. Public', 72, 80);
    doc.fontSize(12).text(SECRET, 72, 110);
    doc.rect(70, 104, 200, 22).fill('#000000');
    doc.end();
  });
  return new Uint8Array(Buffer.concat(chunks));
}

/** Encrypted with a user password; text and cover both present. */
export async function encrypted(password = 'secret') {
  const doc = new PDFKit({ size: 'A4', userPassword: password, ownerPassword: 'owner-secret' });
  const chunks = [];
  await new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', resolve);
    doc.on('error', reject);
    doc.fontSize(12).text(SECRET, 72, 110);
    doc.rect(70, 104, 200, 22).fill('#000000');
    doc.end();
  });
  return new Uint8Array(Buffer.concat(chunks));
}

/** Full-page white background under body text: must NOT be reported. */
export async function cleanDocument() {
  const { doc } = await basePage({ background: true });
  return doc.save();
}

/**
 * A normal, well-built report: dark header bars with white text on top,
 * zebra-striped table rows, a footer, a diagonal watermark painted last.
 * Every fill here is painted before its text. Nothing should be reported.
 */
export async function realisticReport() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 3; p++) {
    const page = doc.addPage([612, 792]);
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 0, y: 740, width: 612, height: 52, color: rgb(0.1, 0.12, 0.2) });
    page.drawText(`Annual Report 2026 — section ${p + 1}`, {
      x: 72, y: 758, size: 16, font, color: rgb(1, 1, 1),
    });
    for (let row = 0; row < 12; row++) {
      const y = 640 - row * 34;
      if (row % 2 === 1) {
        page.drawRectangle({ x: 60, y: y - 8, width: 492, height: 30, color: rgb(0.93, 0.94, 0.96) });
      }
      page.drawText(`Line item ${p + 1}.${row + 1}`, { x: 72, y, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
      page.drawText(`${(row + 1) * 1234}`, { x: 420, y, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
    }
    page.drawText('Confidential — internal use only', {
      x: 120, y: 260, size: 42, font, color: rgb(0.88, 0.88, 0.88),
    });
    page.drawText(`page ${p + 1} of 3`, { x: 520, y: 40, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
  }
  return doc.save();
}

/** Small colored panel painted first, text on top: a highlight, not a leak. */
export async function highlightedPanel() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawRectangle({ x: 72, y: 660, width: 300, height: 60, color: rgb(0.85, 0.9, 1) });
  page.drawText('Q4 summary - confidential review in progress', {
    x: 80, y: 690, size: 12, font, color: rgb(0, 0, 0),
  });
  page.drawText(SECRET, { x: 80, y: 670, size: 12, font, color: rgb(0, 0, 0) });
  return doc.save();
}

export { SECRET };
