// npm run assets:check [folder]: validate an asset folder (default public/assets)
// against docs/art/ASSET_SPEC.md. Exits 1 if any asset is rejected.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatReport, validateAssets } from './validate';

const dir = resolve(process.argv[2] ?? 'public/assets');
if (!existsSync(dir)) {
  console.log(`No assets at ${dir}: nothing to check (the game uses its procedural art).`);
  process.exit(0);
}
const report = await validateAssets(dir);
console.log(formatReport(report));
process.exit(report.errors.length ? 1 : 0);
