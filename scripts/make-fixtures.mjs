/**
 * Writes leaky.pdf and clean.pdf into the current directory so the CLI can be
 * exercised by hand or in CI. Output is gitignored.
 */
import { writeFile } from 'node:fs/promises';
import { paintedOver, trulyRedacted } from '../test/fixtures.mjs';

await writeFile('leaky.pdf', await paintedOver());
await writeFile('clean.pdf', await trulyRedacted());
console.log('wrote leaky.pdf (fake redaction) and clean.pdf (really redacted)');
