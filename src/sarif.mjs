/**
 * SARIF 2.1.0 output.
 *
 * PDFs have no lines, so the location is the file and the page lives in
 * `properties`. That is enough for GitHub code scanning to list the alert,
 * with the covered text (masked) and the cover geometry as context.
 */
const RULES = [
  ['paint-over', 'Dark cover drawn over text', 'A filled shape painted after a text run, which usually means the text was only hidden.'],
  ['whiteout', 'Light cover drawn over text', 'A white or near-white shape painted over text, the classic whiteout.'],
  ['opaque-cover', 'Mid-tone cover drawn over text', 'A shape of another colour painted over text.'],
  ['image-cover', 'Image placed over text', 'A bitmap or stencil mask painted over text.'],
];

const HELP = 'https://github.com/Kayforkind/redact-lint#how-it-decides';

export function toSarif(reports, version) {
  const results = [];
  for (const report of reports) {
    for (const finding of report.findings || []) {
      const run = finding.covered[0];
      const page = finding.page;
      results.push({
        ruleId: finding.kind,
        level: 'error',
        message: {
          text: `${finding.kind} on page ${page}: ${finding.covered.length} covered text run${
            finding.covered.length === 1 ? '' : 's'
          } still extractable ("${run.text}")`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: String(report.file).replace(/\\/g, '/') },
              region: { startLine: 1, startColumn: 1 },
            },
          },
        ],
        properties: {
          page,
          coverage: run.coverage,
          coveredText: run.text,
          cover: {
            type: finding.fill.type,
            color: finding.fill.color,
            x: finding.fill.x,
            y: finding.fill.y,
            width: finding.fill.w,
            height: finding.fill.h,
          },
        },
      });
    }
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'redact-lint',
            informationUri: 'https://github.com/Kayforkind/redact-lint',
            version,
            rules: RULES.map(([id, title, description]) => ({
              id,
              name: title.replace(/[^A-Za-z]/g, ''),
              shortDescription: { text: title },
              fullDescription: { text: description },
              helpUri: HELP,
              defaultConfiguration: { level: 'error' },
            })),
          },
        },
        results,
      },
    ],
  };
}
