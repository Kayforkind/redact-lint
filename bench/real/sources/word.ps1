# Generates the Word fixtures used by bench/real.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File word.ps1 <out.pdf> leak|clean
#
# Word exports a shape over body text as a filled rectangle painted after the
# text, which is exactly the leak this project is about. The clean file is a
# shaded table: Word paints cell backgrounds and text in an interleaved order
# that used to look like a cover to the detector.

param(
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][ValidateSet('leak', 'clean')][string]$Mode
)

$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false

try {
  $doc = $word.Documents.Add()
  $sel = $word.Selection
  $sel.Font.Name = 'Arial'
  $sel.Font.Size = 12
  $sel.TypeText("CONFIDENTIAL MEMO`r`n")
  $sel.Font.Bold = $true
  # ASCII only: Windows PowerShell reads .ps1 as ANSI and an em dash here is a
  # parse error, not a cosmetic problem.
  $sel.TypeText("SSN 123-45-6789 - Account holder: Jane Q. Public`r`n")
  $sel.Font.Bold = $false
  $sel.Font.Size = 10
  $sel.TypeText("This memo is a fixture for a PDF scanner. The line above is meant to look redacted.`r`n")
  $sel.TypeText("Nothing else on this page is sensitive.`r`n")

  if ($Mode -eq 'leak') {
    $range = $doc.Paragraphs.Item(2).Range
    $x = $range.Information(5) # wdHorizontalPositionRelativeToPage
    $y = $range.Information(6) # wdVerticalPositionRelativeToPage
    $shape = $doc.Shapes.AddShape(1, $x - 2, $y - 2, 340, 18)
    $shape.Fill.ForeColor.RGB = 0
    $shape.Line.Visible = 0
    # Default wrap keeps the shape in front of the text, which is how a leak
    # gets exported: the text stays in the content stream underneath.
  }

  if ($Mode -eq 'clean') {
    $table = $doc.Tables.Add($doc.Paragraphs.Item(4).Range, 4, 2)
    $rows = @(
      @('Item', 'Amount'),
      @('Consulting', '12,400'),
      @('Travel', '3,050'),
      @('Total', '15,930')
    )
    for ($r = 1; $r -le 4; $r++) {
      for ($c = 1; $c -le 2; $c++) {
        $table.Cell($r, $c).Range.Text = $rows[$r - 1][$c - 1]
      }
    }
    $table.Rows.Item(1).Shading.BackgroundPatternColor = 2238507 # BGR for #1c2033
    $table.Rows.Item(1).Range.Font.Color = 16777215
  }

  if (Test-Path $Out) { Remove-Item $Out }
  $doc.ExportAsFixedFormat($Out, 17, $false, 0, 0, 0, 0, 0, $true, $true, 0, $true, $true, $false)
  $doc.Close(0)
  Write-Host "wrote $Out"
}
finally {
  $word.Quit()
}
