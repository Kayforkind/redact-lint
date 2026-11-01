/**
 * Writes leaky.pdf and clean.pdf so the CLI can be exercised end to end.
 *
 *   node scripts/make-fixtures.mjs         # into the current directory
 *   node scripts/make-fixtures.mjs demo    # into demo/
 *
 * A leading directory is created if missing. Output is gitignored.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { paintedOver, trulyRedacted } from '../test/fixtures.mjs';

const dir = process.argv[2] || '.';
await mkdir(dir, { recursive: true });

const leaky = path.join(dir, 'leaky.pdf');
const clean = path.join(dir, 'clean.pdf');
await writeFile(leaky, await paintedOver());
await writeFile(clean, await trulyRedacted());
console.log(`wrote ${leaky} (fake redaction) and ${clean} (really redacted)`);
