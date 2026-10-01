// npm run assets:export [folder]: export today's procedural art into the asset
// format (default public/assets), the bootstrap test of docs/art/PLAN.md WP2.
// See procedural.ts.

import { resolve } from 'node:path';
import { exportProcedural } from './procedural';

await exportProcedural(resolve(process.argv[2] ?? 'public/assets'), console.log);
