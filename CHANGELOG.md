# Changelog

Notable changes to `redact-lint`. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-11-01

### Added

- **Image covers.** A bitmap, stencil mask or inline image painted after a text run is now reported as `image-cover`. Page-sized images are treated as backgrounds and stay silent.
- **Encrypted documents.** `--password <pw>` opens a protected PDF. Without a usable password the CLI exits `3` instead of pretending the file is clean.
- **Annotation and form-field text.** `--annotations` collects values from form fields and annotations into `notes`. These are reported separately and never counted as leaks.
- **Waivers.** `.redactlintignore` rules, also selectable with `--ignore-file`. Every rule needs a reason after `#`, and `path.pdf:3` limits a rule to one page. The CLI reports what it suppressed.
- **SARIF 2.1.0.** `--sarif` emits a log for GitHub code scanning and other SARIF consumers.
- **TypeScript declarations** for the library surface, checked by `npm run typecheck`.
- **Pre-commit hook** manifest, so `pre-commit` can run the check on changed PDFs.
- **Accuracy benchmark** in `bench/`, with floors enforced by `npm run bench:check`.
- **Performance budget** in `npm run perf:check`.
- CI now covers the type declarations, benchmark floors, the performance budget, and macOS/Windows as well as Linux.

## [0.2.2]

### Fixed

- Corrected the action's documented version, packaging of the bin, and install-path documentation.

## [0.2.1]

### Fixed

- Documentation corrections after the first action release.

## [0.2.0]

### Added

- GitHub Action that scans the PDFs a pull request changed, writes a job summary and fails on a leak.
- Weekly sweep workflow that keeps one issue in sync with the state of every PDF in a repository.
- `--min-coverage` to tune how much of a text run a cover must span.

## [0.1.3]

### Changed

- Releases publish over npm trusted publishing (OIDC) with a signed provenance statement; no long-lived `NPM_TOKEN`.

## [0.1.2]

### Fixed

- Action outputs are written to `GITHUB_OUTPUT`.

## [0.1.1]

### Fixed

- CLI packaging and executable-bit problems in the published tarball.

## [0.1.0]

### Added

- Initial release: paint-order detection for `paint-over`, `whiteout` and `opaque-cover`, human and `--json` output, and exit codes `0`, `1` and `2`.

[0.3.0]: https://github.com/Kayforkind/redact-lint/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/Kayforkind/redact-lint/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Kayforkind/redact-lint/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Kayforkind/redact-lint/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/Kayforkind/redact-lint/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Kayforkind/redact-lint/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Kayforkind/redact-lint/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Kayforkind/redact-lint/releases/tag/v0.1.0
