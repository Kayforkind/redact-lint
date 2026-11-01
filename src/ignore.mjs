/**
 * Waivers.
 *
 * A false positive that cannot be waived is a reason to stop using the tool,
 * so this exists — and every rule must carry a reason, because an unexplained
 * suppression in a security check is how a real leak gets ignored for a year.
 *
 * File format (`.redactlintignore`), one rule per line:
 *
 *   public/archive/*.pdf                        # scanned before 2019, replaced
 *   docs/report.pdf:3                           # page 3 is a black divider
 *
 * `#` starts the reason. A rule without one is an error, not a silent pass.
 */
import { readFileSync } from 'node:fs';
import { globToRegExp } from './glob.mjs';

export function parseIgnore(text) {
  const rules = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const hash = line.indexOf('#');
    const patternPart = (hash === -1 ? line : line.slice(0, hash)).trim();
    const reason = hash === -1 ? '' : line.slice(hash + 1).trim();
    if (!patternPart) return;
    if (!reason) {
      throw new Error(`line ${index + 1}: "${patternPart}" needs a reason after #`);
    }
    const pageMatch = patternPart.match(/^(.*?):(\d+)$/);
    const glob = pageMatch ? pageMatch[1] : patternPart;
    rules.push({
      glob,
      page: pageMatch ? Number(pageMatch[2]) : null,
      reason,
      re: globToRegExp(glob),
    });
  });
  return rules;
}

/** Loads a waiver file; a missing file is not an error. */
export function loadIgnore(file) {
  try {
    return parseIgnore(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Drops findings covered by a waiver.
 * Returns the surviving result plus the waived findings, so the CLI can say
 * how much it hid rather than pretending they were never there.
 */
export function applyWaivers(result, file, rules) {
  if (!rules.length) return { result, waived: [] };
  const path = String(file).replace(/\\/g, '/');
  const matching = rules.filter((rule) => rule.re.test(path));
  if (!matching.length) return { result, waived: [] };

  const kept = [];
  const waived = [];
  for (const finding of result.findings || []) {
    const rule = matching.find((r) => r.page === null || r.page === finding.page);
    if (rule) {
      waived.push({ ...finding, file: path, reason: rule.reason, rule: rule.page === null ? rule.glob : `${rule.glob}:${rule.page}` });
    } else {
      kept.push(finding);
    }
  }

  return {
    result: {
      ...result,
      findings: kept,
      summary: {
        ...result.summary,
        leaks: kept.length,
        hiddenRuns: kept.reduce((n, f) => n + f.covered.length, 0),
        suppressed: waived.length,
      },
    },
    waived,
  };
}
