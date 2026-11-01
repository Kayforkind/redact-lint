"""Generates the ReportLab fixtures used by bench/real.

    python make_reportlab.py <out-dir>

ReportLab writes the content stream in call order, so a rectangle drawn after
`drawString` is a genuine painted-over leak. The invoice draws row shading
before its text and must stay silent.
"""

import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


def paint_over(path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(72, 760, "CONFIDENTIAL MEMO")
    c.setFont("Helvetica", 12)
    c.drawString(72, 730, "Account holder: Jane Q. Public")
    c.drawString(72, 710, "SSN 123-45-6789")
    c.setFillColorRGB(0, 0, 0)
    c.rect(70, 705, 210, 20, fill=1, stroke=0)
    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica", 10)
    c.drawString(72, 680, "End of memo. Nothing else here is sensitive.")
    c.showPage()
    c.save()


def clean_invoice(path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=A4)
    width, _ = A4
    c.setFillColorRGB(0.11, 0.13, 0.2)
    c.rect(0, 745, width, 45, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(72, 762, "INVOICE 2026-11")
    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica", 11)
    rows = [("Consulting", "12,400"), ("Travel", "3,050"), ("Hosting", "480"), ("Total", "15,930")]
    for i, (item, amount) in enumerate(rows):
        y = 680 - i * 28
        if i % 2 == 0:
            c.setFillColorRGB(0.94, 0.95, 0.97)
            c.rect(60, y - 7, 470, 23, fill=1, stroke=0)
            c.setFillColorRGB(0, 0, 0)
        c.drawString(72, y, item)
        c.drawString(430, y, amount)
    c.showPage()
    c.save()


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)
    paint_over(out / "reportlab-paint-over.pdf")
    clean_invoice(out / "reportlab-clean-invoice.pdf")
    print(f"wrote {out}/reportlab-*.pdf")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
