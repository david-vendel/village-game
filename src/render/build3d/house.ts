// A house: a small cottage on three cells, or a longer house where two or
// three were merged (Building.size). Each one its own, from its seed:
// - a timber-framed cottage of wattle and daub on a fieldstone footing,
//   under a steep thatch;
// - a stone ground floor with a jettied, timber-framed upper storey over the
//   street, under tiles;
// - a rubble-stone cottage with stone gables under shingles or slate.
// The door is where the game lets new villagers out (HOUSE_DOOR_DX), the
// windows spaced along the front clear of it, the chimney at one end. Its
// walls stand on the plot's edges, so a neighbour's wall meets it, and its roof
// runs on flush into the neighbour's; alone, the roof overhangs its gables.

import { HOUSE_DOOR_DX } from '../../game/layout';
import { pick, rng, uniform } from './elements';
import { body, type OpeningSpec, type Storey } from './kit/body';
import { barrel, bench } from './kit/props';
import { pitchFor } from './kit/roof';
import { type Model, ModelBuilder } from './model';
import { m, type Plot } from './plot';

export type HouseStyle = 'cottage' | 'jettied' | 'stone';

export function houseStyle(seed: number): HouseStyle {
  const v = rng(`${seed}:style`)();
  return v < 0.4 ? 'cottage' : v < 0.75 ? 'jettied' : 'stone';
}

export function house(seed: number, plot: Plot): Model {
  const b = new ModelBuilder(seed, plot);
  const r = b.rng('house');
  const style = houseStyle(seed);
  const size = plot.size;
  // the front wall stands a step back from the street: a doorstep with a bench or a water butt
  const rect = { x0: plot.x0, x1: plot.x1, y0: plot.y0 + 0.32, y1: plot.y1 - 0.02 };
  const doorU = m(HOUSE_DOOR_DX[size]);
  const W = rect.x1 - rect.x0;

  let storeys: Storey[];
  let roofStyle: 'thatch' | 'tile' | 'shingle' | 'slate';
  let stoneGables: { left: boolean; right: boolean } | undefined;
  const daub = pick(r, ['daub', 'daub', 'daub-ochre', 'daub-pink']);
  if (style === 'cottage') {
    storeys = [{ kind: 'frame', h: 2.3, infill: 'daub', material: daub }];
    roofStyle = 'thatch';
  } else if (style === 'jettied') {
    storeys = [
      { kind: 'stone', h: 2.15, material: 'rubble', quoins: 'ashlar' },
      { kind: 'frame', h: 2.0, jetty: 0.3, infill: 'daub', material: daub },
    ];
    roofStyle = pick(r, ['tile', 'tile', 'shingle']);
  } else {
    storeys = [{ kind: 'stone', h: 2.35, material: pick(r, ['rubble', 'rubble', 'limewash']), quoins: 'ashlar' }];
    roofStyle = pick(r, ['shingle', 'slate', 'thatch']);
    stoneGables = { left: true, right: true };
  }
  const pitch = pitchFor(roofStyle, uniform(r, 0.3, 0.9));

  // windows along the front, clear of the door, a little uneven as houses are
  const openings: OpeningSpec[] = [{ kind: 'door', side: 'front', u: doorU, w: 0.88, h: 1.82, storey: 0, name: 'door', hinge: r() < 0.5 ? 'left' : 'right' }];
  const spots = (storey: number, avoid: number | null, ww: number) => {
    const out: number[] = [];
    const n = Math.max(1, Math.round(W / 1.9));
    for (let i = 0; i < n; i++) {
      const u = rect.x0 + (W * (i + 0.5)) / n + uniform(r, -0.12, 0.12);
      if (avoid !== null && Math.abs(u - avoid) < 0.88 / 2 + ww / 2 + 0.35) continue;
      if (u - ww / 2 < rect.x0 + 0.35 || u + ww / 2 > rect.x1 - 0.35) continue;
      out.push(u);
    }
    if (!out.length && storey === 0) {
      // a small house: one window on the far side of the door
      const u = doorU < 0 ? rect.x1 - 0.95 : rect.x0 + 0.95;
      if (Math.abs(u - doorU) > 0.88 / 2 + ww / 2 + 0.25) out.push(u);
    }
    return out;
  };
  const ww = uniform(r, 0.55, 0.7);
  let wi = 0;
  for (const u of spots(0, doorU, ww)) openings.push({ kind: 'window', side: 'front', u, w: ww, h: 0.6, storey: 0, sill: storeys[0].kind === 'stone' ? 0.95 : 0.85, name: `window${wi++}`, shutters: r() < 0.7 ? 'pair' : 'single' });
  if (storeys.length > 1) for (const u of spots(1, null, ww)) openings.push({ kind: 'window', side: 'front', u, w: ww, h: 0.62, storey: 1, sill: 0.75, name: `window${wi++}`, shutters: 'pair' });

  const chimneyAt = (doorU > 0 ? rect.x0 + 0.55 : rect.x1 - 0.55) + uniform(r, -0.1, 0.1);
  const chimneys = [{ x: chimneyAt }];
  if (size === 3) chimneys.push({ x: doorU > 0 ? rect.x1 - 0.6 : rect.x0 + 0.6 });

  const info = body(b, {
    rect,
    footing: { h: 0.45 },
    storeys,
    roof: { style: roofStyle, pitchDeg: pitch, eaves: roofStyle === 'thatch' ? 0.3 : 0.32, overL: plot.sides.left ? 0 : 0.28, overR: plot.sides.right ? 0 : 0.28, gableFill: style === 'cottage' ? 'daub' : 'boards', material: roofStyle === 'thatch' ? pick(r, ['thatch', 'thatch-old']) : undefined },
    openings,
    chimneys,
    stoneGables,
  });

  // a bench by the door, a water butt at the corner, for some
  const benchU = doorU < 0 ? doorU + 1.15 : doorU - 1.15;
  if (r() < 0.45 && Math.abs(benchU) < W / 2 - 0.6) bench(b, 'bench', benchU, plot.y0 + 0.16, 0.9, { h: 0.42, depth: 0.26 });
  else if (r() < 0.6) barrel(b, 'butt', doorU < 0 ? rect.x1 - 0.3 : rect.x0 + 0.3, plot.y0 + 0.16, { r: 0.14, h: 0.62 });

  b.point('door', [doorU, plot.y0, 0]);
  info.smoke.forEach((p, i) => b.point(`smoke:${i}`, p));
  const sleepZ = (info.floors[info.floors.length - 1] ?? 0) + 1.3;
  b.point('sleep:0', [rect.x0 + W * 0.3, rect.y0, sleepZ + 0.6]);
  return b.model();
}
