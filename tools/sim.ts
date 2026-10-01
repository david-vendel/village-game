// Play a scenario headless and print the village as text (src/sim).
//
//   npm run sim -- tests/scenarios/houses-merge.scn
//   npm run sim -- -e "new empty; free on; construction off; build farm at s0:40; map"
//
// Commands are separated by new lines (or `;` with -e). Exits 1 if any
// expectation failed, a command was refused or a rule was broken.

import { readFileSync } from 'node:fs';
import { runScenario } from '../src/sim/scenario';

const args = process.argv.slice(2);
const inline = args[0] === '-e';
const script = inline ? args.slice(1).join(' ').split(';').join('\n') : readFileSync(args[0] ?? '/dev/stdin', 'utf8');
const { output, failures } = runScenario(script);
console.log(output);
if (failures.length) {
  console.log(`\n${failures.length} failure${failures.length === 1 ? '' : 's'}:`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
