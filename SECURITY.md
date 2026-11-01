# Security policy

`redact-lint` is a check, not a guarantee. It reads a PDF the way a viewer does
and reports text that is still extractable underneath a cover painted after it.
A clean run means "nothing was found by these rules", and the limitations below
are part of the design, not bugs.

## Supported versions

Only the latest published minor line gets fixes. At the time of writing that is
`0.3.x` on npm. Older versions are not patched; upgrading is the fix.

| Version | Supported |
| --- | --- |
| 0.3.x | Yes |
| < 0.3 | No |

## Reporting a vulnerability

Use **GitHub private vulnerability reporting** — the repository's **Security**
tab → *Report a vulnerability*. Do not open a public issue for a security
problem, and do not attach a document that contains real personal data.

A useful report includes the version (`redact-lint --version`), the platform,
what you expected the scanner to conclude, and either a minimal PDF or the
`test/fixtures.mjs` case that reproduces it. If the document is sensitive,
reproduce it synthetically — every detector test in this repo is built that way.

What to expect:

- acknowledgement within 3 business days
- an initial assessment within 7 business days
- a fix and an advisory, or a reasoned "not a vulnerability", before any public
  write-up; we will credit you unless you ask us not to

## Scope

In scope:

- a false negative or false positive caused by the documented rules — text that
  a viewer shows as covered but that extracts, or text wrongly reported
- a crash, hang or unbounded memory use on a malformed or hostile PDF
- anything in the published tarball that does not match this repository
- a bypass of the masking in output that prints covered text by default

Out of scope:

- the redaction mistakes in third-party documents. Finding those is the point of
  the tool.
- vulnerabilities in `pdfjs-dist`. They belong upstream at
  [mozilla/pdf.js](https://github.com/mozilla/pdf.js); report them there and, if
  the bug is reachable through this tool, tell us as well.
- documents that cannot be opened without their own password. `--password` is
  the intended path; exit code `3` signals a missing one.
- the known limitations listed below, unless you can show a case that the
  documented rule should have caught.

## Known limitations

- **Flattened pages.** If a bad redaction was rasterized into the page image,
  there is no text left to extract and nothing is reported, even though the
  pixels may still show the content.
- **Image covers.** A bitmap painted over text is reported as `image-cover`;
  what the image itself contains is not inspected.
- **Invisible text that was never covered** — drawn in the background colour or
  clipped away — is a different bug and is not detected.
- **Fonts without a Unicode mapping** produce empty text runs, which cannot be
  reported.
- **Clipping, blend modes and transparency groups** are approximated: the tool
  assumes an opaque fill and reports `opacity` as `1`.
- **Full-page covers** are treated as page backgrounds by design; a sheet
  covering more than 60% of the page is not a redaction box.
- **Encrypted documents** are not opened without `--password` (exit code `3`).

## Threat model

| Asset | Attacker | Mitigation |
| --- | --- | --- |
| The document's content | Whoever receives the exported PDF | The tool's purpose: report text that survives under a cover |
| The content of CI logs and job summaries | Anyone who can read the repository's Actions runs | Covered text is masked unless `--show-text` is passed; the action never passes it by default |
| The developer's machine | A malicious PDF opened by the scanner | PDFs are parsed by `pdfjs-dist` and never executed; no shell commands are built from document content; nothing is fetched from the network at scan time |
| The dependency chain | A compromised package in the tree | One runtime dependency (`pdfjs-dist`), lockfile committed, `npm audit --omit=dev` in CI, releases published over npm trusted publishing with provenance, so no long-lived token exists to steal |

The scanner runs offline. The only network access in the whole project is the
`npm install` the GitHub Action performs to fetch a pinned version of the
scanner itself.

## Waivers

A `.redactlintignore` entry hides a finding; it does not fix the document.
Every rule must carry a reason, and the CLI prints what it waived and why.
If a waiver stays in place for a document that still ships, the document still
leaks. Treat the file as an audit trail, not as a mop.
