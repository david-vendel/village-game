// npx tsx tools/building-gen/elements.ts <type> [seed]: print a building's
// construction elements and named points as JSON, from the game's own
// generator (src/render/build3d). The Blender scene builders read this, so the
// architecture rules live in one place (the game) and the offline sprite
// renders match the real-time 3D.

import { farm, farmPoints } from '../../src/render/build3d/farm';

const GENERATORS = { farm: { elements: farm, points: farmPoints } } as const;

const type = process.argv[2] as keyof typeof GENERATORS;
const seed = Number(process.argv[3] ?? 7);
const gen = GENERATORS[type];
if (!gen) {
  console.error(`usage: elements.ts <${Object.keys(GENERATORS).join('|')}> [seed]`);
  process.exit(2);
}
process.stdout.write(JSON.stringify({ elements: gen.elements(seed), points: gen.points() }));
