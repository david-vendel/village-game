// The farm: a farmhouse over its barn, on six cells by three. The ground
// floor is the barn, of fieldstone, opening on the yard through three wide
// round arches turned in dressed voussoirs, each closed by a pair of dark
// plank leaves; the middle one is where the farmer comes home (HOME). Over it,
// standing out over the yard on its joists and braced on curved brackets, the
// family's floor: a timber frame of dark oak filled with cream daub, small
// shuttered windows with boxes of flowers, under a steep roof of weathered
// tiles with a dormer and a leaning stone chimney. Ivy climbs the stone; a
// hay cart, barrels and bales stand about. In front of the left arch the grain
// store's ground (STORE) is kept clear below head height for the stooks. The
// Large farm (variant "upgraded") makes a second room in the roof, a dormer
// with its window, and a second hearth with its own chimney: the footprint
// stays. farm(seed) gives both looks merged (elements.ts mergeLooks).

import { HOME } from '../../game/layout';
import { mergeLooks, pick, uniform, type Vec3 } from './elements';
import { body, type OpeningSpec } from './kit/body';
import { ivy, type WallRef, bush } from './kit/openings';
import { barrel, cart, hayBale, lantern } from './kit/props';
import { dormer, dormerGap } from './kit/roof';
import { type Model, ModelBuilder } from './model';
import { m, type Plot, plotOf } from './plot';

/** How far back from the plot's front the barn wall stands: the grain store's strip before it. */
export const YARD = 1.0;
/** How far the living floor stands out over the yard. */
export const JETTY = 0.6;
/** The barn's arches: middle along the front, width (the middle one is the farmer's door). */
export const ARCHES = [
  { name: 'gateL', u: -2.55, w: 1.6 },
  { name: 'door', u: -0.35, w: 1.7 },
  { name: 'gateR', u: 1.85, w: 1.7 },
] as const;
/** The gable rising through the eaves over the right end: its middle and width. */
export const CROSS = { cx: 2.3, w: 2.1 };

function look(seed: number, plot: Plot, upgraded: boolean): ModelBuilder {
  const b = new ModelBuilder(seed, plot);
  const r = b.rng('farm');
  const rect = { x0: plot.x0, x1: plot.x1, y0: plot.y0 + YARD, y1: plot.y1 - 0.05 };
  const doorU = m(HOME.dx);
  const fz = 0.3;
  const stoneH = 2.55;
  const upperH = 2.05;

  const openings: OpeningSpec[] = ARCHES.map((a) => ({ kind: 'gate' as const, side: 'front' as const, u: a.u, w: a.w, h: a.w / 2 + 1.15, storey: 0, name: a.name, arch: true }));
  // a small barred light for the stalls at the right end
  openings.push({ kind: 'window', side: 'front', u: 3.3, w: 0.42, h: 0.46, storey: 0, sill: 1.3, name: 'window0', shutters: 'single' });
  // the living floor's windows, a little uneven as an old house's are
  [-2.8, -1.15, 0.6, 2.3].forEach((u, i) => openings.push({ kind: 'window', side: 'front', u: u + uniform(r, -0.06, 0.06), w: 0.6, h: 0.66, storey: 1, sill: 0.68 + uniform(r, -0.05, 0.05), name: `window${i + 1}`, shutters: 'pair' }));

  // over the right end the living floor's front rises into a gable of its own through the eaves
  const wallTop = fz + stoneH + 0.16 + upperH;
  const gable = { cx: CROSS.cx, w: CROSS.w, h: 1.0, wallTop };
  const daub = pick(r, ['daub', 'daub', 'daub-ochre']);
  const chimneys = [{ x: plot.x0 + 0.85 + uniform(r, -0.08, 0.08), w: 0.66, d: 0.56, material: 'fieldstone', rough: true, lean: -0.07, above: 0.8 }];
  if (upgraded) chimneys.push({ x: plot.x1 - 0.8, w: 0.52, d: 0.48, material: 'fieldstone', rough: true, lean: 0.03, above: 0.55 });
  const info = body(b, {
    rect,
    footing: { h: fz },
    storeys: [
      { kind: 'stone', h: stoneH, material: 'fieldstone', quoins: 'ashlar', thick: 0.45 },
      { kind: 'frame', h: upperH, jetty: JETTY, infill: 'daub', material: daub },
    ],
    roof: { style: 'tile', pitchDeg: uniform(r, 49, 53), eaves: 0.35, overL: plot.sides.left ? 0 : 0.3, overR: plot.sides.right ? 0 : 0.3, gableFill: 'daub', gaps: [dormerGap(gable)] },
    openings,
    chimneys,
    noGreenery: true,
  });

  // curved brackets under the jetty, on corbel stones in the piers between the arches
  const stoneTop = info.floors[1] - 0.16;
  const piers = [plot.x0 + 0.16, -1.47, 0.75, plot.x1 - 0.16];
  piers.forEach((x, i) => {
    b.box(`bracket${i}.corbel`, 'corbel', [x, rect.y0 - 0.06, stoneTop - 0.62], [0.24, 0.16, 0.14], 'ashlar', 'frame', [], { shape: 'stone', params: { dressed: 1 } });
    const foot: Vec3 = [x, rect.y0 - 0.05, stoneTop - 0.55];
    const knee: Vec3 = [x, rect.y0 - JETTY * 0.45, stoneTop - 0.2];
    const head: Vec3 = [x, rect.y0 - JETTY + 0.1, stoneTop - 0.02];
    b.beam(`bracket${i}.a`, 'bracket', foot, knee, [0.13, 0.13], 'frame', []);
    b.beam(`bracket${i}.b`, 'bracket', knee, head, [0.13, 0.13], 'frame', []);
  });

  // the dormers: one over the hall; the Large farm makes a second room in the roof
  const roof = info.roof;
  const upper = info.rects[1];
  const dy = upper.y0 + 0.5;
  const dormerWins: Vec3[] = dormer(b, { ...gable, roof, y: upper.y0, pitchDeg: 54, style: 'tile', daub, windows: [{ w: 0.6, h: 0.56, name: 'gable.window', shutters: 'pair', flowers: true }], prefix: 'gable.' });
  const dormers = [{ cx: -1.55 + uniform(r, -0.1, 0.1), name: 'dormer0' }];
  if (upgraded) dormers.push({ cx: 0.2, name: 'dormer1' });
  for (const d of dormers) dormerWins.push(...dormer(b, { cx: d.cx, w: 1.1, roof, y: dy, h: 1.15, pitchDeg: 52, style: 'tile', daub, windows: [{ w: 0.48, h: 0.5, name: `${d.name}.window` }], prefix: `${d.name}.` }));
  dormerWins.forEach((p) => b.point(`window:${Object.keys(b.points).filter((n) => n.startsWith('window:')).length}`, p));

  // ivy up the piers, a lantern by the door, the cart, barrels and bales
  const front: WallRef = { side: 'front', face: rect.y0, thick: 0.45 };
  const g = b.rng('green');
  ivy(b, 'ivy0', front, plot.x0 + 0.2, 2.75, 0.42 + g() * 0.15);
  ivy(b, 'ivy1', front, 0.75 + uniform(g, -0.05, 0.05), 2.4 + g() * 0.4, 0.3);
  ivy(b, 'ivy2', front, plot.x1 - 0.25, 2.2 + g() * 0.5, 0.4);
  lantern(b, 'lantern', 0.75, rect.y0, 1.95);
  b.point('lamp:0', [0.75, rect.y0 - 0.25, 1.95]);
  cart(b, 'cart', 2.75, plot.y0 + 0.5, { dir: -1, load: 'hay' });
  barrel(b, 'barrel0', 0.62, rect.y0 - 0.26, { r: 0.21, h: 0.66 });
  barrel(b, 'barrel1', 0.98, rect.y0 - 0.22, { r: 0.16, h: 0.5 });
  hayBale(b, 'bale0', 3.35, rect.y0 - 0.06 - 0.3, { r: 0.28, len: 0.5, along: 'y', z: 0 });
  bush(b, 'bush0', plot.x1 - 0.3, plot.y0 + 0.2, 0.42);

  b.point('door', [doorU, plot.y0, 0]);
  info.smoke.forEach((p, i) => b.point(`smoke:${i}`, p));
  const sleepZ = info.floors[1] + 1.25;
  b.point('sleep:0', [-1.15, upper.y0, sleepZ]);
  b.point('sleep:1', upgraded ? dormerWins[2] : [0.6, upper.y0, sleepZ]);
  return b;
}

/** One look of the farm: the default or the Large farm. */
export function farmLook(upgraded: boolean, seed = 7, plot: Plot = plotOf('farm')): Model {
  return look(seed, plot, upgraded).model();
}

/** Both looks merged: shared elements once, the rest tagged by the look they belong to. */
export function farm(seed: number, plot: Plot): Model {
  const def = look(seed, plot, false);
  const up = look(seed, plot, true);
  return { elements: mergeLooks(def.out, up.out), points: { ...up.points, ...def.points, 'sleep:1': up.points['sleep:1'] }, anims: { ...def.anims, ...up.anims } };
}
