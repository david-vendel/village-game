// Every scenario in tests/scenarios (src/sim/scenario.ts) is played headless:
// it must run without a failed expectation, a refused command or a broken
// rule, and print what it printed last time (tests/scenarios/*.out). After a
// change that is meant to change what a scenario shows, look at the diff and
// update with `npx vitest run tests/scenarios.test.ts -u`.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScenario } from '../src/sim/scenario';

const DIR = join(__dirname, 'scenarios');

describe('scenarios', () => {
  for (const name of readdirSync(DIR).filter((f) => f.endsWith('.scn'))) {
    it(name, async () => {
      const { output, failures } = runScenario(readFileSync(join(DIR, name), 'utf8'));
      expect(failures).toEqual([]);
      await expect(output + '\n').toMatchFileSnapshot(join(DIR, name.replace(/\.scn$/, '.out')));
    });
  }
});
