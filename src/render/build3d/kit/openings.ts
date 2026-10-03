// Doors and windows. A door is a frame (or the stone reveal), a threshold
// stone, and a leaf of upright planks on ledges with iron strap hinges and a
// ring, hung to swing in; a window has a frame, a mullion, a pane of oiled
// linen or horn that glows when there is light inside, and shutters hung
// outside that fold back flat against the wall by day and close over it at
// night. The leaves and shutters are moving parts (model.ts), each turning
// about its own hinge.

import type { Stage, Vec3 } from '../elements';
import type { ModelBuilder } from '../model';

/** Which wall an opening is in: its outer face line, and which way is out. */
export interface WallRef {
  side: 'front' | 'back' | 'left' | 'right';
  /** The wall's outer face: y for the front and back, x for the sides. */
  face: number;
  thick: number;
}

const outSign = (w: WallRef) => (w.side === 'front' || w.side === 'left' ? -1 : 1);
const alongX = (w: WallRef) => w.side === 'front' || w.side === 'back';
/** A point in a wall: u along it, d into it from the outer face, z up. */
const inWall = (w: WallRef, u: number, d: number, z: number): Vec3 => {
  const c = w.face - outSign(w) * d;
  return alongX(w) ? [u, c, z] : [c, u, z];
};
const sized = (w: WallRef, along: number, deep: number, h: number): Vec3 => (alongX(w) ? [along, deep, h] : [deep, along, h]);

export interface DoorSpec {
  wall: WallRef;
  /** Middle of the doorway along the wall. */
  u: number;
  w: number;
  h: number;
  /** Threshold height (top of the step it opens onto). */
  z0: number;
  name: string;
  hinge?: 'left' | 'right';
  /** An oak frame round it (in a timber or log wall the posts are its jambs; a stone wall has its reveal). */
  frame?: boolean;
  stage?: Stage;
  /** Plank colour. */
  wood?: string;
  /** Arched head (a chapel): the leaf's top rounds off. */
  arched?: boolean;
}

/** A door: frame, threshold, and the leaf as a moving part. Returns the doorway's middle on the ground outside. */
export function door(b: ModelBuilder, d: DoorSpec): Vec3 {
  const w = d.wall;
  const st = d.stage ?? 'walls';
  const pre = `${d.name}.`;
  const wood = d.wood ?? 'paint';
  if (d.frame !== false) {
    for (const s of [-1, 1]) b.box(`${pre}jamb${s}`, 'door-frame', inWall(w, d.u + s * (d.w / 2 + 0.045), w.thick / 2, d.z0 + d.h / 2), sized(w, 0.09, w.thick + 0.02, d.h), 'oak', st, []);
    b.box(`${pre}head`, 'door-frame', inWall(w, d.u, w.thick / 2, d.z0 + d.h + 0.05), sized(w, d.w + 0.18, w.thick + 0.02, 0.1), 'oak', st, []);
  }
  // the threshold, worn in the middle
  b.box(`${pre}threshold`, 'threshold', inWall(w, d.u, w.thick / 2, d.z0 - 0.05), sized(w, d.w + 0.1, w.thick, 0.1), 'ashlar', st, [], { shape: 'stone', params: { dressed: 1 } });
  // the dark of the doorway behind the leaf (the room inside shows when it opens)
  b.box(`${pre}dark`, 'doorway', inWall(w, d.u, w.thick - 0.012, d.z0 + d.h / 2), sized(w, d.w, 0.02, d.h), 'interior', st, []);
  // the leaf: planks on ledges, strap hinges, a ring; hung on the hinge side, swinging in
  const hinge = d.hinge ?? 'left';
  const hs = hinge === 'left' ? -1 : 1;
  const hu = d.u + hs * (d.w / 2 - 0.02);
  const leafD = 0.05;
  const pivot = inWall(w, hu, 0.06 + leafD, d.z0);
  // turning in: the free edge swings to the inside of the wall
  const turn = w.side === 'front' || w.side === 'right' ? -hs : hs;
  b.part(d.name, { kind: 'door', pivot, axis: [0, 0, 1], open: turn * ((105 * Math.PI) / 180) }, () => {
    const planks = Math.max(3, Math.round(d.w / 0.17));
    const pw = (d.w - 0.02) / planks;
    for (let i = 0; i < planks; i++) {
      const u = d.u - d.w / 2 + 0.01 + pw * (i + 0.5);
      // an arched head: the outer planks shorter
      const rise = d.arched ? Math.sqrt(Math.max(0, 1 - ((u - d.u) / (d.w / 2)) ** 2)) * (d.w / 2) : 0;
      const ph = d.h - (d.arched ? d.w / 2 : 0) + rise - 0.01;
      b.box(`${pre}plank${i}`, 'door', inWall(w, u, 0.06 + leafD / 2, d.z0 + ph / 2 + 0.005), sized(w, pw - 0.006, leafD, ph), wood, st, []);
    }
    for (const z of [0.3, d.h - 0.4]) {
      b.box(`${pre}ledge${z.toFixed(1)}`, 'ledge', inWall(w, d.u, 0.06 + leafD + 0.015, d.z0 + z), sized(w, d.w - 0.08, 0.03, 0.12), wood, st, []);
      // strap hinges on the outside, from the hinge side most of the way across
      b.box(`${pre}strap${z.toFixed(1)}`, 'hinge', inWall(w, hu - hs * d.w * 0.33, 0.055, d.z0 + z), sized(w, d.w * 0.66, 0.012, 0.045), 'iron', st, []);
    }
    b.box(`${pre}ring`, 'handle', inWall(w, d.u - hs * (d.w / 2 - 0.14), 0.05, d.z0 + d.h * 0.52), sized(w, 0.07, 0.02, 0.07), 'iron', st, []);
  });
  const out = inWall(w, d.u, -0.0, 0);
  return [out[0], out[1], 0];
}

export interface GateSpec {
  wall: WallRef;
  /** Middle of the gateway along the wall, its width, and its height (to the crown, if arched). */
  u: number;
  w: number;
  h: number;
  /** Threshold height. */
  z0: number;
  /** The leaves are moving parts `${name}L` and `${name}R`. */
  name: string;
  /** A round head (an arch in a stone wall): the leaves' tops follow it. */
  arched?: boolean;
  stage?: Stage;
  wood?: string;
  /** How far into the wall the leaves hang from its face. */
  set?: number;
  /** How far each leaf swings in when open, radians. */
  open?: number;
}

/**
 * A barn's or cart shed's gateway: two leaves of heavy upright planks on ledges with a brace between
 * them, long iron strap hinges, each leaf a moving part hung on its jamb and swinging in; the tops
 * cut to the arch when it has one. Returns the gateway's middle on the ground outside.
 */
export function gate(b: ModelBuilder, g: GateSpec): Vec3 {
  const w = g.wall;
  const st = g.stage ?? 'walls';
  const pre = `${g.name}.`;
  const wood = g.wood ?? 'planks';
  const set = g.set ?? Math.min(0.16, w.thick * 0.4);
  const R = g.w / 2;
  b.box(`${pre}threshold`, 'threshold', inWall(w, g.u, w.thick / 2, g.z0 - 0.05), sized(w, g.w + 0.06, w.thick, 0.1), 'ashlar', st, [], { shape: 'stone', params: { dressed: 1 } });
  b.box(`${pre}dark`, 'doorway', inWall(w, g.u, w.thick - 0.012, g.z0 + g.h / 2), sized(w, g.w, 0.02, g.h), 'interior', st, []);
  const leafD = 0.06;
  /** The leaf's height at u along the wall (cut to the arch). */
  const heightAt = (u: number) => (g.arched ? g.h - R + Math.sqrt(Math.max(0, R * R - (u - g.u) ** 2)) : g.h) - 0.015;
  for (const hs of [-1, 1] as const) {
    const name = `${g.name}${hs < 0 ? 'L' : 'R'}`;
    const hu = g.u + hs * (g.w / 2 - 0.015);
    const leaf = g.w / 2 - 0.02;
    const turn = w.side === 'front' || w.side === 'right' ? -hs : hs;
    b.part(name, { kind: 'door', pivot: inWall(w, hu, set + leafD, g.z0), axis: [0, 0, 1], open: turn * (g.open ?? (100 * Math.PI) / 180) }, () => {
      const planks = Math.max(3, Math.round(leaf / 0.19));
      const pw = leaf / planks;
      const r = b.rng(name);
      for (let i = 0; i < planks; i++) {
        const u0 = hu - hs * pw * i;
        const u1 = hu - hs * pw * (i + 1);
        // the plank as tall as the arch lets it at its inner edge
        const ph = Math.min(heightAt(u0), heightAt(u1)) - 0.005;
        b.box(`${name}.plank${i}`, 'door', inWall(w, (u0 + u1) / 2, set + leafD / 2, g.z0 + ph / 2 + 0.01), sized(w, pw - 0.008, leafD - uniformish(r), ph), wood, st, []);
      }
      // ledges and a brace on the face, rising from the hinge side's foot
      const zl = [0.32, Math.min(g.h - R, g.h - 0.45)];
      const mid = hu - hs * (leaf / 2);
      for (const [k, z] of zl.entries()) {
        b.box(`${name}.ledge${k}`, 'ledge', inWall(w, mid, set - 0.015, g.z0 + z), sized(w, leaf - 0.05, 0.03, 0.13), wood, st, []);
        // the strap hinge, from the pin most of the way across, with a curled end
        b.box(`${name}.strap${k}`, 'hinge', inWall(w, hu - hs * leaf * 0.36, set - 0.035, g.z0 + z), sized(w, leaf * 0.72, 0.012, 0.05), 'iron', st, []);
        b.box(`${name}.pin${k}`, 'hinge', inWall(w, hu, set - 0.02, g.z0 + z), sized(w, 0.05, 0.05, 0.12), 'iron', st, []);
      }
      b.beam(`${name}.brace`, 'brace', inWall(w, hu - hs * 0.1, set - 0.015, g.z0 + zl[0] + 0.07), inWall(w, hu - hs * (leaf - 0.1), set - 0.015, g.z0 + zl[1] - 0.07), [0.12, 0.03], st, [], wood);
      if (hs > 0) b.box(`${name}.ring`, 'handle', inWall(w, hu - hs * (leaf - 0.1), set - 0.03, g.z0 + 1.05), sized(w, 0.08, 0.02, 0.08), 'iron', st, []);
    });
  }
  const out = inWall(w, g.u, 0, 0);
  return [out[0], out[1], 0];
}

/** A plank a hair thinner or thicker than the next. */
const uniformish = (r: () => number) => (r() - 0.5) * 0.012;

export interface WindowSpec {
  wall: WallRef;
  u: number;
  w: number;
  h: number;
  /** Height of the bottom of the opening. */
  z0: number;
  name: string;
  shutters?: 'pair' | 'single' | 'none';
  /** A frame of its own (an oak casing; a stone wall's reveal needs none). */
  frame?: boolean;
  mullion?: boolean;
  stage?: Stage;
  /** Stained glass in lead (a chapel), not linen. */
  glass?: 'linen' | 'stained';
  /** No flower box under it. */
  flowers?: boolean;
}

const FLOWERS = ['flower-red', 'flower-pink', 'flower-yellow', 'flower-white', 'flower-red'];

/** A window box of flowers hung under a sill on the wall's face: a painted box, leaves, blooms. */
export function flowerBox(b: ModelBuilder, id: string, w: WallRef, u: number, len: number, zTop: number): void {
  b.tagged(['part:flowers'], () => {
    b.box(`${id}.box`, 'flower-box', inWall(w, u, -0.11, zTop - 0.1), sized(w, len, 0.18, 0.16), 'paint', 'roof', []);
    for (const k of [-1, 1]) b.box(`${id}.bracket${k}`, 'bracket', inWall(w, u + k * (len / 2 - 0.08), -0.06, zTop - 0.24), sized(w, 0.04, 0.12, 0.16), 'iron', 'roof', []);
    const r = b.rng(id);
    const n = Math.max(3, Math.round(len / 0.11));
    for (let i = 0; i < n; i++) {
      const uu = u - len / 2 + 0.05 + ((len - 0.1) * (i + 0.5)) / n;
      b.box(`${id}.leaf${i}`, 'leaves', inWall(w, uu, -0.11 + (r() - 0.5) * 0.06, zTop - 0.03), sized(w, 0.12, 0.13, 0.1 + r() * 0.06), r() < 0.5 ? 'leaves' : 'leaves-dark', 'roof', [], { shape: 'dome' });
      if (r() < 0.75) b.box(`${id}.bloom${i}`, 'bloom', inWall(w, uu + (r() - 0.5) * 0.05, -0.12 + (r() - 0.5) * 0.08, zTop + 0.05 + r() * 0.05), sized(w, 0.05, 0.05, 0.045), FLOWERS[Math.floor(r() * FLOWERS.length)], 'roof', [], { shape: 'dome' });
    }
  });
}

/**
 * Ivy climbing a wall face from its foot: clumps of leaves spreading as they rise, thinning out
 * towards the top (part:ivy). u along the wall, up to `top`.
 */
export function ivy(b: ModelBuilder, id: string, w: WallRef, u: number, top: number, spread = 0.5): void {
  b.tagged(['part:ivy'], () => {
    const r = b.rng(id);
    let k = 0;
    for (let z = 0.15; z < top; z += 0.16) {
      const f = z / top;
      const width = spread * (0.35 + 0.9 * Math.sin(Math.min(1, f * 1.4) * Math.PI * 0.5)) * (1 - 0.6 * f * f);
      const n = Math.max(1, Math.round((width / 0.14) * (1 - f * 0.5)));
      for (let i = 0; i < n; i++) {
        if (r() < f * 0.45) continue;
        const uu = u + (r() - 0.5) * width * 2;
        const s = 0.1 + r() * 0.09;
        b.box(`${id}.${k++}`, 'ivy', inWall(w, uu, -0.035, z + (r() - 0.5) * 0.08), sized(w, s * 1.4, 0.07, s), r() < 0.6 ? 'leaves' : 'leaves-dark', 'roof', [], { shape: 'stone' });
      }
    }
  });
}

/** A flowering bush on the ground at plan point (x, y), about `size` across (part:ivy, with the greenery). */
export function bush(b: ModelBuilder, id: string, x: number, y: number, size = 0.32): void {
  b.tagged(['part:ivy'], () => {
    const r = b.rng(id);
    for (let i = 0; i < 4; i++) {
      const s = size * (0.6 + r() * 0.4);
      b.box(`${id}.${i}`, 'bush', [x + (r() - 0.5) * size * 0.8, y + (r() - 0.5) * size * 0.1, 0], [s * 0.5, s * 0.42, s * 0.6], i % 2 ? 'leaves' : 'leaves-dark', 'roof', [], { shape: 'dome', params: { rough: 0.25 } });
    }
    for (let i = 0; i < 6; i++) b.box(`${id}.bloom${i}`, 'bloom', [x + (r() - 0.5) * size * 1.1, y - size * 0.2 + (r() - 0.5) * size * 0.1, size * (0.3 + r() * 0.3)], [0.045, 0.045, 0.04], FLOWERS[Math.floor(r() * FLOWERS.length)], 'roof', [], { shape: 'dome' });
  });
}

/** A window: casing, mullion, a pane that glows when lit, and shutters as moving parts. Returns its middle. */
export function window_(b: ModelBuilder, s: WindowSpec): Vec3 {
  const w = s.wall;
  const st = s.stage ?? 'walls';
  const pre = `${s.name}.`;
  const zc = s.z0 + s.h / 2;
  if (s.frame !== false) {
    for (const k of [-1, 1]) b.box(`${pre}jamb${k}`, 'window-frame', inWall(w, s.u + k * (s.w / 2 + 0.03), 0.06, zc), sized(w, 0.06, 0.1, s.h + 0.12), 'oak', st, []);
    for (const k of [-1, 1]) b.box(`${pre}rail${k}`, 'window-frame', inWall(w, s.u, 0.06, zc + k * (s.h / 2 + 0.03)), sized(w, s.w + 0.12, 0.1, 0.06), 'oak', st, []);
  }
  // the pane, set into the wall
  b.box(`${pre}pane`, 'pane', inWall(w, s.u, Math.min(w.thick * 0.5, 0.12), zc), sized(w, s.w, 0.02, s.h), s.glass === 'stained' ? 'stained' : 'glass', st, []);
  // the reveal's inner side: dark
  b.box(`${pre}dark`, 'reveal', inWall(w, s.u, Math.min(w.thick * 0.5, 0.12) + 0.015, zc), sized(w, s.w + 0.02, 0.01, s.h + 0.02), 'interior', st, []);
  if (s.mullion !== false) {
    b.box(`${pre}mullion`, 'mullion', inWall(w, s.u, Math.min(w.thick * 0.5, 0.12) - 0.02, zc), sized(w, 0.04, 0.05, s.h), 'oak', st, []);
    if (s.h > 0.55) b.box(`${pre}transom`, 'mullion', inWall(w, s.u, Math.min(w.thick * 0.5, 0.12) - 0.02, zc + s.h * 0.12), sized(w, s.w, 0.05, 0.04), 'oak', st, []);
  }
  // a box of flowers under a window high enough off the ground (a style puts them out: part:flowers)
  if (s.flowers !== false && s.glass !== 'stained' && s.z0 > 0.7 && w.side === 'front') flowerBox(b, `${pre}flowers`, w, s.u, s.w + 0.1, s.z0 - 0.02);
  const kind = s.shutters ?? 'pair';
  if (kind !== 'none') {
    const leaves: Array<{ hs: -1 | 1; width: number }> = kind === 'pair' ? [
      { hs: -1, width: s.w / 2 },
      { hs: 1, width: s.w / 2 },
    ] : [{ hs: -1, width: s.w }];
    for (const [i, leaf] of leaves.entries()) {
      const hu = s.u + leaf.hs * (s.w / 2 + 0.02);
      const pivot = inWall(w, hu, -0.025, s.z0);
      const name = `${s.name}.shutter${i}`;
      // folding out past the wall face and flat back against it beside the window
      const sign = alongX(w) ? (w.side === 'front' ? 1 : -1) : w.side === 'right' ? 1 : -1;
      b.part(name, { kind: 'shutter', pivot, axis: [0, 0, 1], open: leaf.hs * sign * ((172 * Math.PI) / 180) }, () => {
        const cu = hu - leaf.hs * (leaf.width / 2 + 0.005);
        const boards = Math.max(2, Math.round(leaf.width / 0.13));
        for (let k = 0; k < boards; k++) {
          const u = hu - leaf.hs * (0.005 + (leaf.width / boards) * (k + 0.5));
          b.box(`${pre}sh${i}.b${k}`, 'shutter', inWall(w, u, -0.025, zc), sized(w, leaf.width / boards - 0.006, 0.03, s.h + 0.04), 'paint', st, []);
        }
        for (const z of [s.h * 0.22, s.h * 0.78]) b.box(`${pre}sh${i}.ledge${z.toFixed(2)}`, 'ledge', inWall(w, cu, -0.05, s.z0 + z), sized(w, leaf.width - 0.04, 0.02, 0.07), 'paint', st, []);
      });
    }
  }
  return inWall(w, s.u, 0, zc);
}
